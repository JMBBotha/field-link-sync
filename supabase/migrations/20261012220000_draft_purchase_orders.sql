-- 2026-10-12 Lean draft purchase orders (manual 'Create draft POs' on a paid invoice). Drafts only: nothing is emailed.
-- Rollback: docs/db-releases/2026-10-12_draft_purchase_orders_rollback.sql
-- PO line cost = supplier_products.cost_price as stored (already the supplier cost). No further discount is applied or stored.

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS our_account_number text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS order_emails text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS awaiting_stock boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  po_number text NOT NULL,
  seq integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','ordered','received','cancelled')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  client_name text,
  job_reference text,
  supplier_account_number text,
  supplier_emails text[] NOT NULL DEFAULT '{}',
  deliver_to text,
  notes text,
  subtotal numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, po_number)
);
CREATE INDEX IF NOT EXISTS purchase_orders_invoice_idx ON public.purchase_orders(invoice_id);
CREATE INDEX IF NOT EXISTS purchase_orders_job_idx ON public.purchase_orders(job_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  model_code text,
  description text,
  qty numeric NOT NULL CHECK (qty > 0),
  unit_cost_excl_vat numeric NOT NULL CHECK (unit_cost_excl_vat >= 0),
  line_total_excl_vat numeric NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx ON public.purchase_order_items(po_id);

-- Supplier invoices / delivery notes: internal only, never shown to clients or suppliers.
CREATE TABLE IF NOT EXISTS public.purchase_order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('supplier_invoice','delivery_note','other')),
  storage_path text NOT NULL,
  file_name text,
  internal_only boolean NOT NULL DEFAULT true CHECK (internal_only),
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.po_office_ok(_company uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL AND _company = public.caller_company_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR (public.has_role(auth.uid(), 'dispatcher'::app_role) AND NOT public.is_sales_rep(auth.uid())));
$f$;
REVOKE ALL ON FUNCTION public.po_office_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.po_office_ok(uuid) TO authenticated;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_office_all ON public.purchase_orders;
CREATE POLICY po_office_all ON public.purchase_orders FOR ALL TO authenticated
  USING (public.po_office_ok(company_id)) WITH CHECK (public.po_office_ok(company_id));
DROP POLICY IF EXISTS poi_office_all ON public.purchase_order_items;
CREATE POLICY poi_office_all ON public.purchase_order_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_id AND public.po_office_ok(p.company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_orders p WHERE p.id = po_id AND public.po_office_ok(p.company_id)));
DROP POLICY IF EXISTS pod_office_all ON public.purchase_order_documents;
CREATE POLICY pod_office_all ON public.purchase_order_documents FOR ALL TO authenticated
  USING (public.po_office_ok(company_id)) WITH CHECK (public.po_office_ok(company_id));

-- Private bucket, path {company_id}/{po_id}/{uuid}-{file}
INSERT INTO storage.buckets (id, name, public) VALUES ('po-documents', 'po-documents', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS "pod_obj_all" ON storage.objects;
CREATE POLICY "pod_obj_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'po-documents' AND (storage.foldername(name))[1] = public.caller_company_id()::text
         AND public.po_office_ok(public.caller_company_id()))
  WITH CHECK (bucket_id = 'po-documents' AND (storage.foldername(name))[1] = public.caller_company_id()::text
         AND public.po_office_ok(public.caller_company_id()));

-- Manual: one draft PO per supplier for the unit lines of a PAID invoice that are linked to a catalogue product.
-- Idempotent: suppliers that already have a non-cancelled PO for this invoice are skipped.
CREATE OR REPLACE FUNCTION public.create_draft_pos_for_invoice(p_invoice uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_inv public.invoices%ROWTYPE; v_job public.jobs%ROWTYPE; v_prof public.company_profiles%ROWTYPE;
  s record; v_po uuid; v_seq int; v_num text; v_created jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
  v_unlinked int; v_sub numeric;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice FOR UPDATE;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.po_office_ok(v_inv.company_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_inv.status <> 'paid' THEN RAISE EXCEPTION 'Invoice % is %, POs are only created for paid invoices', v_inv.invoice_number, v_inv.status; END IF;
  SELECT * INTO v_job FROM public.jobs WHERE invoice_id = v_inv.id AND company_id = v_inv.company_id
    AND status <> 'cancelled' ORDER BY created_at LIMIT 1;
  SELECT * INTO v_prof FROM public.company_profiles WHERE id = COALESCE(v_inv.company_profile_id, public.default_company_profile(v_inv.company_id));
  SELECT count(*) INTO v_unlinked FROM public.invoice_items WHERE invoice_id = v_inv.id AND line_type = 'unit' AND product_id IS NULL;

  FOR s IN SELECT sp.supplier_id FROM public.invoice_items ii JOIN public.supplier_products sp ON sp.id = ii.product_id
            WHERE ii.invoice_id = v_inv.id GROUP BY sp.supplier_id LOOP
    IF EXISTS (SELECT 1 FROM public.purchase_orders WHERE invoice_id = v_inv.id AND supplier_id = s.supplier_id AND status <> 'cancelled') THEN
      v_skipped := v_skipped || to_jsonb(s.supplier_id); CONTINUE;
    END IF;
    SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM public.purchase_orders WHERE invoice_id = v_inv.id;
    v_num := 'PO-' || v_inv.invoice_number || '-' || lpad(v_seq::text, 2, '0');
    INSERT INTO public.purchase_orders (company_id, supplier_id, po_number, seq, invoice_id, job_id, customer_id, client_name, job_reference,
        supplier_account_number, supplier_emails, deliver_to, notes)
    SELECT v_inv.company_id, su.id, v_num, v_seq, v_inv.id, v_job.id, v_inv.customer_id, v_inv.customer_name,
        COALESCE(v_job.title, 'Invoice ' || v_inv.invoice_number),
        su.our_account_number,
        CASE WHEN cardinality(su.order_emails) > 0 THEN su.order_emails ELSE array_remove(ARRAY[su.main_email], NULL) END,
        array_to_string(v_prof.address_lines, ', '),
        'Send invoices and delivery notes to: accounts@0800becool.co.za'
      FROM public.suppliers su WHERE su.id = s.supplier_id
      RETURNING id INTO v_po;
    INSERT INTO public.purchase_order_items (po_id, product_id, invoice_item_id, model_code, description, qty, unit_cost_excl_vat, line_total_excl_vat, sort_order)
    SELECT v_po, sp.id, ii.id, sp.product_code, COALESCE(NULLIF(sp.short_name, ''), sp.description), ii.quantity,
           ROUND(COALESCE(sp.cost_price, 0), 2), ROUND(COALESCE(sp.cost_price, 0) * ii.quantity, 2), COALESCE(ii.sort_order, 0)
      FROM public.invoice_items ii JOIN public.supplier_products sp ON sp.id = ii.product_id
     WHERE ii.invoice_id = v_inv.id AND sp.supplier_id = s.supplier_id;
    SELECT COALESCE(sum(line_total_excl_vat), 0) INTO v_sub FROM public.purchase_order_items WHERE po_id = v_po;
    UPDATE public.purchase_orders SET subtotal = v_sub, vat_amount = ROUND(v_sub * 0.15, 2), total = v_sub + ROUND(v_sub * 0.15, 2) WHERE id = v_po;
    v_created := v_created || jsonb_build_object('id', v_po, 'po_number', v_num);
  END LOOP;
  IF v_job.id IS NOT NULL AND jsonb_array_length(v_created) > 0 THEN
    UPDATE public.jobs SET awaiting_stock = true WHERE id = v_job.id;
  END IF;
  RETURN jsonb_build_object('created', v_created, 'skipped_suppliers', v_skipped, 'unlinked_unit_lines', v_unlinked);
END $f$;
REVOKE ALL ON FUNCTION public.create_draft_pos_for_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_pos_for_invoice(uuid) TO authenticated;

-- Seed Samsung/Fourways ordering details
UPDATE public.suppliers SET our_account_number = 'MAS70001',
  order_emails = ARRAY['sales@fourwaysgroup.co.za', 'Mandy.Oliphant@fourwaysgroup.co.za']
 WHERE id = '64dad53f-73f5-4cbb-9c39-6b298aeb8c41';
