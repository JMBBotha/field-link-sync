-- Expected money and WALDA stock intake. NOT applied by this change.
-- Apply this file before the client that writes cf_receipts.part 'other', status 'cancelled',
-- source 'walda', or calls the new RPCs. Reading open invoices on Home does not need it.
-- Does not update invoices or payments. Stock movements stay append-only.
-- Undo: supabase/manual/20261116143000_walda_money_and_stock_rollback.sql

-- ---------- expected money columns ----------
ALTER TABLE public.cf_receipts ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE public.cf_receipts ADD COLUMN IF NOT EXISTS customer_id uuid;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.cf_receipts'::regclass AND contype = 'c'
  LOOP
    IF r.def ILIKE '%source%' AND r.def NOT ILIKE '%source_ref%' THEN
      EXECUTE format('ALTER TABLE public.cf_receipts DROP CONSTRAINT %I', r.conname);
    ELSIF r.def ILIKE '%part%' AND r.def NOT ILIKE '%source%' THEN
      EXECUTE format('ALTER TABLE public.cf_receipts DROP CONSTRAINT %I', r.conname);
    ELSIF r.def ILIKE '%status%' THEN
      EXECUTE format('ALTER TABLE public.cf_receipts DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.cf_receipts
  ADD CONSTRAINT cf_receipts_source_chk CHECK (source IN ('field_lynk','manual','freshbooks','walda'));
ALTER TABLE public.cf_receipts
  ADD CONSTRAINT cf_receipts_part_chk CHECK (part IN ('deposit','progress','final','full','other'));
ALTER TABLE public.cf_receipts
  ADD CONSTRAINT cf_receipts_status_chk CHECK (status IN ('expected','received','written_off','cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS cf_receipts_walda_ref
  ON public.cf_receipts (company_id, source_ref)
  WHERE source = 'walda' AND source_ref IS NOT NULL;

-- Supplier slips WALDA stores use source walda. manual and assistant stay.
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.supplier_job_documents') IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.supplier_job_documents'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%source_ref%'
  LOOP
    EXECUTE format('ALTER TABLE public.supplier_job_documents DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_job_documents_source_chk'
      AND conrelid = 'public.supplier_job_documents'::regclass
  ) THEN
    ALTER TABLE public.supplier_job_documents
      ADD CONSTRAINT supplier_job_documents_source_chk CHECK (source IN ('manual','assistant','walda'));
  END IF;
END $$;

-- Stamp the intake on each new movement. Movements stay append-only; this only fills a null on insert.
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS intake_id uuid;
ALTER TABLE public.stock_units ADD COLUMN IF NOT EXISTS intake_id uuid;
ALTER TABLE public.stock_units ADD COLUMN IF NOT EXISTS project_house_id uuid;

DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.stock_units') IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.stock_units'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%job_received%'
  LOOP
    EXECUTE format('ALTER TABLE public.stock_units DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_units_origin_chk' AND conrelid = 'public.stock_units'::regclass
  ) THEN
    ALTER TABLE public.stock_units ADD CONSTRAINT stock_units_origin_chk CHECK (
      (origin = 'job_received' AND (received_job_id IS NOT NULL OR project_house_id IS NOT NULL))
      OR (origin = 'general_stock' AND received_job_id IS NULL AND project_house_id IS NULL)
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.stock_intake_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v text;
BEGIN
  IF NEW.intake_id IS NULL THEN
    v := nullif(current_setting('walda.intake_id', true), '');
    IF v IS NOT NULL THEN NEW.intake_id := v::uuid; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stock_intake_stamp_trg ON public.stock_movements;
CREATE TRIGGER stock_intake_stamp_trg BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.stock_intake_stamp();

CREATE TABLE IF NOT EXISTS public.stock_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('material_purchase','unit_purchase','return','direct_delivery','allocate')),
  source text NOT NULL CHECK (source IN ('manual','walda')),
  source_ref text,
  supplier_name text,
  doc_ref text,
  doc_date date,
  payment_status text CHECK (payment_status IS NULL OR payment_status IN ('unpaid','paid')),
  bank_line_id uuid,
  attachment_path text,
  job_id uuid,
  project_house_id uuid,
  customer_id uuid,
  client_name text,
  linked_intake_id uuid,
  note text,
  review_needed boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  supplier_document_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_intakes_source_ref
  ON public.stock_intakes (company_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_intakes_company ON public.stock_intakes (company_id, doc_date DESC);

CREATE TABLE IF NOT EXISTS public.stock_intake_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.stock_intakes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  line_no int NOT NULL DEFAULT 1,
  line_kind text NOT NULL CHECK (line_kind IN ('material','unit')),
  item_label text NOT NULL,
  model_text text,
  product_id uuid,
  stock_item_id uuid,
  qty numeric NOT NULL,
  unit_name text,
  unit_cost_excl numeric,
  total_cost_excl numeric,
  bucket text,
  matched boolean NOT NULL DEFAULT false,
  review_needed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS stock_intake_lines_intake ON public.stock_intake_lines (intake_id);

CREATE TABLE IF NOT EXISTS public.material_pool_averages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  per text NOT NULL CHECK (per IN ('metre','install')),
  qty numeric NOT NULL CHECK (qty >= 0),
  unit_name text NOT NULL DEFAULT 'm',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, label, per)
);

DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('purchase-slips', 'purchase-slips', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
    EXECUTE 'DROP POLICY IF EXISTS purchase_slips_admin_rw ON storage.objects';
    EXECUTE $p$CREATE POLICY purchase_slips_admin_rw ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'purchase-slips' AND public._cf_ok(((storage.foldername(name))[1])::uuid))
      WITH CHECK (bucket_id = 'purchase-slips' AND public._cf_ok(((storage.foldername(name))[1])::uuid))$p$;
  END IF;
END $$;

-- ---------- shared checks ----------
CREATE OR REPLACE FUNCTION public._walda_attachment(p_path text, p_company uuid) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text := nullif(btrim(p_path), '');
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF length(v) > 500 THEN RAISE EXCEPTION 'Attachment path is too long' USING ERRCODE = '22023'; END IF;
  IF v ~* '/object/public/' THEN RAISE EXCEPTION 'Attachment must be a private file for this company' USING ERRCODE = '22023'; END IF;
  IF position(p_company::text IN v) = 0 THEN RAISE EXCEPTION 'Attachment path must sit in this company''s folder' USING ERRCODE = '22023'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._walda_attachment(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._house_install_job(p_company uuid, p_house uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job uuid; v_no text; v_customer uuid;
BEGIN
  IF p_house IS NULL OR to_regclass('public.project_houses') IS NULL THEN RETURN NULL; END IF;
  SELECT h.house_no, pr.customer_id INTO v_no, v_customer
  FROM public.project_houses h JOIN public.projects pr ON pr.id = h.project_id
  WHERE h.id = p_house AND h.company_id = p_company;
  IF v_no IS NULL THEN RETURN NULL; END IF;
  SELECT j.id INTO v_job
  FROM public.jobs j
  WHERE j.company_id = p_company AND j.customer_id = v_customer
    AND lower(coalesce(j.job_type, '')) = 'installation'
    AND coalesce(j.title, '') ~* ('(^|[^a-z0-9])house[[:space:]]*(no\.?[[:space:]]*|#[[:space:]]*)?' || regexp_replace(v_no, '([^a-z0-9])', '\\\1', 'gi') || '([^0-9a-z]|$)')
  ORDER BY j.created_at DESC NULLS LAST
  LIMIT 1;
  RETURN v_job;
END $$;
REVOKE ALL ON FUNCTION public._house_install_job(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._pool_item(p_company uuid, p_label text, p_unit_cost numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_label text := left(btrim(p_label), 160);
BEGIN
  SELECT id INTO v_id FROM public.cf_stock_items
  WHERE company_id = p_company AND lower(item) = lower(v_label) LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.cf_stock_items (company_id, item, qty_on_hand, unit_cost_excl)
    VALUES (p_company, v_label, 0, coalesce(p_unit_cost, 0)) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._pool_item(uuid, text, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._match_model(p_model text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text; v_id uuid; v_n int;
BEGIN
  IF to_regclass('public.supplier_products') IS NULL THEN RETURN NULL; END IF;
  v_key := NULLIF(regexp_replace(upper(regexp_replace(coalesce(p_model, ''), '[^A-Za-z0-9]', '', 'g')), 'P$', ''), '');
  IF v_key IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n FROM public.supplier_products p
  WHERE NULLIF(regexp_replace(upper(regexp_replace(coalesce(p.product_code, ''), '[^A-Za-z0-9]', '', 'g')), 'P$', ''), '') = v_key;
  IF v_n = 1 THEN
    SELECT p.id INTO v_id FROM public.supplier_products p
    WHERE NULLIF(regexp_replace(upper(regexp_replace(coalesce(p.product_code, ''), '[^A-Za-z0-9]', '', 'g')), 'P$', ''), '') = v_key
    LIMIT 1;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._match_model(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._move_for_intake(
  p_company uuid, p_intake uuid, p_kind text, p_bucket text, p_item uuid, p_product uuid, p_label text,
  p_qty numeric, p_cost numeric, p_job uuid, p_doc uuid, p_line uuid, p_unit uuid, p_reason text, p_value numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('walda.intake_id', coalesce(p_intake::text, ''), true);
  RETURN public._stock_move(
    p_company, p_kind, p_bucket, p_item, p_product, p_label, p_qty, p_cost, NULL, p_job, p_doc, p_line,
    NULL, p_unit, p_reason, NULL, NULL, NULL, coalesce(p_value, 0)
  );
END $$;
REVOKE ALL ON FUNCTION public._move_for_intake(uuid,uuid,text,text,uuid,uuid,text,numeric,numeric,uuid,uuid,uuid,uuid,text,numeric) FROM PUBLIC, anon, authenticated;

-- ---------- expected money ----------
CREATE OR REPLACE FUNCTION public.walda_record_expected_money(
  p_amount numeric, p_expected_on date, p_kind text,
  p_client text DEFAULT NULL, p_customer uuid DEFAULT NULL, p_invoice uuid DEFAULT NULL,
  p_note text DEFAULT NULL, p_source_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  co uuid := public._walda_co();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_amt numeric; v_note text; v_ref text; v_client text;
  v_old public.cf_receipts%ROWTYPE; v_new public.cf_receipts%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  i int;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL THEN RAISE EXCEPTION 'Amount is required' USING ERRCODE = '22023'; END IF;
  v_amt := round(p_amount, 2);
  IF v_amt <= 0 OR v_amt > 1000000000 THEN RAISE EXCEPTION 'Amount is not an expected amount' USING ERRCODE = '22023'; END IF;
  IF v_kind NOT IN ('deposit','final','other') THEN RAISE EXCEPTION 'Kind must be deposit, final or other' USING ERRCODE = '22023'; END IF;
  IF p_expected_on IS NULL OR p_expected_on < DATE '2000-01-01' OR p_expected_on > v_today + 1825 THEN
    RAISE EXCEPTION 'Expected date is required' USING ERRCODE = '22023';
  END IF;
  v_note := nullif(btrim(p_note), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
  v_ref := nullif(btrim(p_source_ref), '');
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023'; END IF;
  v_client := nullif(left(btrim(coalesce(p_client, '')), 200), '');
  IF p_customer IS NOT NULL AND to_regclass('public.customers') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer AND c.company_id = co) THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = '42501';
  END IF;
  IF p_invoice IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice AND i.company_id = co) THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
  END IF;

  IF v_ref IS NULL THEN
    INSERT INTO public.cf_receipts (company_id, source, source_ref, customer_id, invoice_id, ref, client, part, amount_incl, expected_date, note, status)
    VALUES (co, 'walda', NULL, p_customer, p_invoice, coalesce(v_client, 'Expected'), v_client, v_kind, v_amt, p_expected_on, v_note, 'expected')
    RETURNING * INTO v_new;
    PERFORM public._bot_audit(co, 'expected_money_inserted', 'cf_receipts', v_new.id, NULL, to_jsonb(v_new));
    RETURN jsonb_build_object('result','inserted','id',v_new.id,'amount',v_new.amount_incl,'expected_on',v_new.expected_date,'kind',v_new.part,'status',v_new.status);
  END IF;

  FOR i IN 1..2 LOOP
    SELECT * INTO v_old FROM public.cf_receipts
    WHERE company_id = co AND source = 'walda' AND source_ref = v_ref
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF v_old.status <> 'expected' AND (
           v_old.amount_incl IS DISTINCT FROM v_amt OR v_old.expected_date IS DISTINCT FROM p_expected_on
           OR v_old.part IS DISTINCT FROM v_kind OR v_old.invoice_id IS DISTINCT FROM p_invoice
         ) THEN
        RAISE EXCEPTION 'This expected amount is already %', v_old.status USING ERRCODE = '22023';
      END IF;
      IF v_old.amount_incl = v_amt AND v_old.expected_date IS NOT DISTINCT FROM p_expected_on
         AND v_old.part = v_kind AND v_old.client IS NOT DISTINCT FROM v_client
         AND v_old.invoice_id IS NOT DISTINCT FROM p_invoice AND v_old.customer_id IS NOT DISTINCT FROM p_customer
         AND v_old.note IS NOT DISTINCT FROM v_note THEN
        PERFORM public._bot_audit(co, 'expected_money_skipped', 'cf_receipts', v_old.id, to_jsonb(v_old), to_jsonb(v_old));
        RETURN jsonb_build_object('result','skipped','id',v_old.id,'amount',v_old.amount_incl,'expected_on',v_old.expected_date,'kind',v_old.part,'status',v_old.status);
      END IF;
      UPDATE public.cf_receipts
      SET amount_incl = v_amt, expected_date = p_expected_on, part = v_kind, client = v_client, ref = coalesce(v_client, ref),
          invoice_id = p_invoice, customer_id = p_customer, note = v_note, updated_at = now()
      WHERE id = v_old.id RETURNING * INTO v_new;
      PERFORM public._bot_audit(co, 'expected_money_updated', 'cf_receipts', v_new.id, to_jsonb(v_old), to_jsonb(v_new));
      RETURN jsonb_build_object('result','updated','id',v_new.id,'amount',v_new.amount_incl,'expected_on',v_new.expected_date,'kind',v_new.part,'status',v_new.status);
    END IF;
    BEGIN
      INSERT INTO public.cf_receipts (company_id, source, source_ref, customer_id, invoice_id, ref, client, part, amount_incl, expected_date, note, status)
      VALUES (co, 'walda', v_ref, p_customer, p_invoice, coalesce(v_client, 'Expected'), v_client, v_kind, v_amt, p_expected_on, v_note, 'expected')
      RETURNING * INTO v_new;
      PERFORM public._bot_audit(co, 'expected_money_inserted', 'cf_receipts', v_new.id, NULL, to_jsonb(v_new));
      RETURN jsonb_build_object('result','inserted','id',v_new.id,'amount',v_new.amount_incl,'expected_on',v_new.expected_date,'kind',v_new.part,'status',v_new.status);
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the expected amount';
END $$;

-- The rest of the stock RPCs live in the next section of this file.
-- ---------- stock posting helpers used by the RPCs below ----------
CREATE OR REPLACE FUNCTION public._open_supplier_doc(
  p_company uuid, p_source text, p_ref text, p_supplier text, p_doc_type text, p_doc_ref text,
  p_doc_date date, p_attachment text, p_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_ref IS NOT NULL THEN
    SELECT id INTO v_id FROM public.supplier_job_documents
    WHERE company_id = p_company AND source_ref = p_ref LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.supplier_job_documents (company_id, supplier_name, doc_type, doc_number, doc_date, storage_path, notes, source, source_ref, created_by)
    VALUES (p_company, p_supplier, p_doc_type, p_doc_ref, p_doc_date, p_attachment, p_note, p_source, p_ref, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._open_supplier_doc(uuid,text,text,text,text,text,date,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._add_doc_line(
  p_doc uuid, p_company uuid, p_no int, p_label text, p_model text, p_qty numeric, p_job uuid, p_cost numeric, p_bucket text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.supplier_job_document_lines (
    document_id, company_id, line_no, description, model_number, qty, job_id, unit_cost_excl, receive_bucket, delivered_with_doc, received_at
  ) VALUES (
    p_doc, p_company, p_no, left(p_label, 200), p_model, p_qty, p_job, p_cost, p_bucket, true, now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._add_doc_line(uuid,uuid,int,text,text,numeric,uuid,numeric,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.walda_record_material_purchase(
  p_item text, p_qty numeric, p_unit text, p_total_cost numeric, p_doc_date date,
  p_supplier text DEFAULT NULL, p_doc_ref text DEFAULT NULL, p_invoice_ref text DEFAULT NULL,
  p_paid boolean DEFAULT false, p_bank_line uuid DEFAULT NULL, p_note text DEFAULT NULL,
  p_source_ref text DEFAULT NULL, p_attachment text DEFAULT NULL, p_already_used numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid := public._walda_co();
BEGIN
  RETURN public._record_material_purchase(co, 'walda', p_item, p_qty, p_unit, p_total_cost, p_doc_date, p_supplier, p_doc_ref, p_invoice_ref, p_paid, p_bank_line, p_note, p_source_ref, p_attachment, p_already_used);
END $$;

CREATE OR REPLACE FUNCTION public.record_material_purchase(
  p_item text, p_qty numeric, p_unit text, p_total_cost numeric, p_doc_date date,
  p_supplier text DEFAULT NULL, p_doc_ref text DEFAULT NULL, p_invoice_ref text DEFAULT NULL,
  p_paid boolean DEFAULT false, p_bank_line uuid DEFAULT NULL, p_note text DEFAULT NULL,
  p_source_ref text DEFAULT NULL, p_attachment text DEFAULT NULL, p_already_used numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid;
BEGIN
  IF to_regprocedure('public._stock_reject_bot()') IS NOT NULL THEN PERFORM public._stock_reject_bot(); END IF;
  co := public.caller_company_id();
  IF NOT public._cf_ok(co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN public._record_material_purchase(co, 'manual', p_item, p_qty, p_unit, p_total_cost, p_doc_date, p_supplier, p_doc_ref, p_invoice_ref, p_paid, p_bank_line, p_note, p_source_ref, p_attachment, p_already_used);
END $$;

CREATE OR REPLACE FUNCTION public._record_material_purchase(
  p_company uuid, p_source text, p_item text, p_qty numeric, p_unit text, p_total_cost numeric, p_doc_date date,
  p_supplier text, p_doc_ref text, p_invoice_ref text, p_paid boolean, p_bank_line uuid, p_note text,
  p_source_ref text, p_attachment text, p_already_used numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item text := nullif(btrim(p_item), '');
  v_unit text := lower(nullif(btrim(p_unit), ''));
  v_qty numeric; v_used numeric; v_total numeric; v_cost numeric;
  v_note text; v_ref text; v_att text; v_docref text; v_inv text; v_supplier text;
  v_payload jsonb; v_old public.stock_intakes%ROWTYPE; v_id uuid; v_doc uuid; v_line uuid; v_stock uuid;
  v_paid text; i int; v_result text;
BEGIN
  IF NOT public.is_company_writable(p_company) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF v_item IS NULL THEN RAISE EXCEPTION 'Item is required' USING ERRCODE = '22023'; END IF;
  IF v_unit IS NULL OR v_unit NOT IN ('m','each','kg','l','roll') THEN RAISE EXCEPTION 'Unit must be m, each, kg, l or roll' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than zero' USING ERRCODE = '22023'; END IF;
  v_qty := round(p_qty, 3);
  v_used := round(coalesce(p_already_used, 0), 3);
  IF v_used < 0 OR v_used > v_qty THEN RAISE EXCEPTION 'Already used is more than the quantity bought' USING ERRCODE = '22023'; END IF;
  IF p_total_cost IS NULL OR p_total_cost < 0 THEN RAISE EXCEPTION 'Total cost is required' USING ERRCODE = '22023'; END IF;
  v_total := round(p_total_cost, 2);
  v_cost := round(v_total / v_qty, 4);
  IF p_doc_date IS NULL OR p_doc_date < DATE '2000-01-01' THEN RAISE EXCEPTION 'Date is required' USING ERRCODE = '22023'; END IF;
  IF p_doc_date > (now() AT TIME ZONE 'Africa/Johannesburg')::date + 31 THEN RAISE EXCEPTION 'Date cannot be that far ahead' USING ERRCODE = '22023'; END IF;
  v_note := nullif(btrim(p_note), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
  v_ref := nullif(btrim(p_source_ref), '');
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023'; END IF;
  v_att := public._walda_attachment(p_attachment, p_company);
  v_supplier := nullif(left(btrim(coalesce(p_supplier, '')), 160), '');
  v_docref := nullif(left(btrim(coalesce(p_doc_ref, '')), 80), '');
  v_inv := nullif(left(btrim(coalesce(p_invoice_ref, p_doc_ref, '')), 80), '');
  v_paid := CASE WHEN coalesce(p_paid, false) THEN 'paid' ELSE 'unpaid' END;
  IF p_bank_line IS NOT NULL AND to_regclass('public.bank_lines') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.bank_lines b WHERE b.id = p_bank_line AND b.company_id = p_company) THEN
    RAISE EXCEPTION 'Bank line not found' USING ERRCODE = '42501';
  END IF;
  v_payload := jsonb_build_object(
    'item', v_item, 'qty', v_qty, 'unit', v_unit, 'total', v_total, 'date', p_doc_date,
    'supplier', v_supplier, 'doc_ref', v_docref, 'invoice_ref', v_inv, 'paid', v_paid,
    'bank_line', p_bank_line, 'note', v_note, 'attachment', v_att, 'already_used', v_used
  );

  FOR i IN 1..2 LOOP
    v_old := NULL;
    IF v_ref IS NOT NULL THEN
      SELECT * INTO v_old FROM public.stock_intakes WHERE company_id = p_company AND source_ref = v_ref FOR UPDATE;
    END IF;
    IF v_old.id IS NOT NULL THEN
      IF v_old.kind <> 'material_purchase' THEN RAISE EXCEPTION 'That source reference is already used for a different record' USING ERRCODE = '22023'; END IF;
      IF v_old.payment_status = 'paid' AND v_paid <> 'paid' THEN
        v_paid := 'paid';
        p_bank_line := coalesce(p_bank_line, v_old.bank_line_id);
        v_payload := v_payload || jsonb_build_object('paid', 'paid', 'bank_line', p_bank_line);
      END IF;
      IF v_old.payload = v_payload THEN
        PERFORM public._bot_audit(p_company, 'material_purchase_skipped', 'stock_intakes', v_old.id, v_old.payload, v_old.payload);
        RETURN jsonb_build_object('result','skipped','id',v_old.id,'kind','material_purchase','bucket','material_pool');
      END IF;
      IF (v_old.payload->>'item') IS DISTINCT FROM v_item OR (v_old.payload->>'unit') IS DISTINCT FROM v_unit
         OR (v_old.payload->>'qty')::numeric IS DISTINCT FROM v_qty OR (v_old.payload->>'total')::numeric IS DISTINCT FROM v_total
         OR (v_old.payload->>'already_used')::numeric IS DISTINCT FROM v_used THEN
        IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.intake_id = v_old.id AND m.kind IN ('use','allocate','return'))
           OR EXISTS (SELECT 1 FROM public.stock_intakes r WHERE r.linked_intake_id = v_old.id) THEN
          RAISE EXCEPTION 'This purchase is already used or credited. Book a return instead of changing it.' USING ERRCODE = '22023';
        END IF;
        v_stock := public._pool_item(p_company, v_item, v_cost);
        PERFORM public._move_for_intake(p_company, v_old.id, 'adjust', 'material_pool', v_stock, NULL, v_item,
          round(v_qty - (v_old.payload->>'qty')::numeric, 3), v_cost, NULL, v_old.supplier_document_id, NULL, NULL,
          'WALDA correction', round(v_total - (v_old.payload->>'total')::numeric - (v_qty - (v_old.payload->>'qty')::numeric) * v_cost, 2));
        IF v_used IS DISTINCT FROM coalesce((v_old.payload->>'already_used')::numeric, 0) THEN
          PERFORM public._move_for_intake(p_company, v_old.id, 'use', 'material_pool', v_stock, NULL, v_item,
            round(-(v_used - coalesce((v_old.payload->>'already_used')::numeric, 0)), 3), v_cost, NULL, v_old.supplier_document_id, NULL, NULL,
            'Already used', 0);
        END IF;
        UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand + (v_qty - v_used) - ((v_old.payload->>'qty')::numeric - coalesce((v_old.payload->>'already_used')::numeric, 0)), 0), updated_at = now() WHERE id = v_stock;
      END IF;
      UPDATE public.stock_intakes SET supplier_name = v_supplier, doc_ref = coalesce(v_inv, v_docref), doc_date = p_doc_date,
        payment_status = v_paid, bank_line_id = p_bank_line, attachment_path = v_att, note = v_note, payload = v_payload, updated_at = now()
      WHERE id = v_old.id;
      PERFORM public._bot_audit(p_company, 'material_purchase_updated', 'stock_intakes', v_old.id, v_old.payload, v_payload);
      RETURN jsonb_build_object('result','updated','id',v_old.id,'kind','material_purchase','bucket','material_pool','total',v_total);
    END IF;
    BEGIN
      INSERT INTO public.stock_intakes (company_id, kind, source, source_ref, supplier_name, doc_ref, doc_date, payment_status, bank_line_id, attachment_path, note, payload, created_by)
      VALUES (p_company, 'material_purchase', p_source, v_ref, v_supplier, coalesce(v_inv, v_docref), p_doc_date, v_paid, p_bank_line, v_att, v_note, v_payload, auth.uid())
      RETURNING id INTO v_id;
      v_doc := public._open_supplier_doc(p_company, p_source, v_ref, v_supplier, 'supplier_invoice', coalesce(v_inv, v_docref), p_doc_date, v_att, v_note);
      v_stock := public._pool_item(p_company, v_item, v_cost);
      v_line := public._add_doc_line(v_doc, p_company, 1, v_item, NULL, v_qty, NULL, v_cost, 'material_pool');
      PERFORM public._move_for_intake(p_company, v_id, 'receive', 'material_pool', v_stock, NULL, v_item, v_qty, v_cost, NULL, v_doc, v_line, NULL, 'Materials purchase', 0);
      IF v_used > 0 THEN
        PERFORM public._move_for_intake(p_company, v_id, 'use', 'material_pool', v_stock, NULL, v_item, -v_used, v_cost, NULL, v_doc, v_line, NULL, 'Already used', 0);
      END IF;
      UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand + (v_qty - v_used), unit_cost_excl = v_cost, updated_at = now() WHERE id = v_stock;
      UPDATE public.stock_intakes SET supplier_document_id = v_doc WHERE id = v_id;
      INSERT INTO public.stock_intake_lines (intake_id, company_id, line_kind, item_label, qty, unit_name, unit_cost_excl, total_cost_excl, bucket, stock_item_id)
      VALUES (v_id, p_company, 'material', v_item, v_qty, v_unit, v_cost, v_total, 'material_pool', v_stock);
      PERFORM public._bot_audit(p_company, 'material_purchase_inserted', 'stock_intakes', v_id, NULL, v_payload);
      v_result := 'inserted';
      RETURN jsonb_build_object('result', v_result, 'id', v_id, 'kind', 'material_purchase', 'bucket', 'material_pool', 'total', v_total, 'already_used', v_used);
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the materials purchase';
END $$;

REVOKE ALL ON FUNCTION public._record_material_purchase(uuid,text,text,numeric,text,numeric,date,text,text,text,boolean,uuid,text,text,text,numeric) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.walda_record_unit_purchase(
  p_supplier text, p_doc_ref text, p_doc_date date, p_model text, p_qty numeric, p_unit_cost numeric,
  p_job uuid DEFAULT NULL, p_project_house uuid DEFAULT NULL, p_invoice_ref text DEFAULT NULL,
  p_paid boolean DEFAULT false, p_bank_line uuid DEFAULT NULL, p_note text DEFAULT NULL,
  p_source_ref text DEFAULT NULL, p_attachment text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  co uuid := public._walda_co();
  v_supplier text := nullif(left(btrim(coalesce(p_supplier,'')),160),'');
  v_docno text := nullif(left(btrim(coalesce(p_doc_ref,'')),80),'');
  v_inv text := nullif(left(btrim(coalesce(p_invoice_ref,p_doc_ref,'')),80),'');
  v_model text := nullif(btrim(p_model),'');
  v_qty int; v_cost numeric; v_note text; v_ref text; v_att text; v_paid text;
  v_job uuid := p_job; v_house uuid := p_project_house; v_product uuid; v_review boolean := false;
  v_bucket text; v_origin text; v_payload jsonb; v_old public.stock_intakes%ROWTYPE;
  v_id uuid; v_doc uuid; v_line uuid; v_stock uuid; v_unit uuid; n int; i int;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF v_supplier IS NULL THEN RAISE EXCEPTION 'Supplier is required' USING ERRCODE = '22023'; END IF;
  IF v_docno IS NULL THEN RAISE EXCEPTION 'Document reference is required' USING ERRCODE = '22023'; END IF;
  IF p_doc_date IS NULL OR p_doc_date < DATE '2000-01-01' THEN RAISE EXCEPTION 'Date is required' USING ERRCODE = '22023'; END IF;
  IF v_model IS NULL THEN RAISE EXCEPTION 'Model or size is required' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty <> trunc(p_qty) OR p_qty <= 0 OR p_qty > 500 THEN RAISE EXCEPTION 'Quantity must be a whole number' USING ERRCODE = '22023'; END IF;
  v_qty := p_qty::int;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN RAISE EXCEPTION 'Unit cost is required' USING ERRCODE = '22023'; END IF;
  v_cost := round(p_unit_cost, 2);
  v_note := nullif(btrim(p_note),'');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
  v_ref := nullif(btrim(p_source_ref),'');
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023'; END IF;
  v_att := public._walda_attachment(p_attachment, co);
  v_paid := CASE WHEN coalesce(p_paid,false) THEN 'paid' ELSE 'unpaid' END;
  IF p_job IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.company_id = co) THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501'; END IF;
  IF p_project_house IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.project_houses h WHERE h.id = p_project_house AND h.company_id = co) THEN
    RAISE EXCEPTION 'Project house not found' USING ERRCODE = '42501'; END IF;
  IF v_job IS NULL AND v_house IS NOT NULL THEN v_job := public._house_install_job(co, v_house); END IF;
  IF p_bank_line IS NOT NULL AND to_regclass('public.bank_lines') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.bank_lines b WHERE b.id = p_bank_line AND b.company_id = co) THEN
    RAISE EXCEPTION 'Bank line not found' USING ERRCODE = '42501'; END IF;
  v_product := public._match_model(v_model);
  v_review := v_product IS NULL;
  IF v_job IS NOT NULL OR v_house IS NOT NULL THEN v_bucket := 'job_unit'; v_origin := 'job_received';
  ELSE v_bucket := 'general_unit'; v_origin := 'general_stock'; v_job := NULL; END IF;
  v_payload := jsonb_build_object('supplier',v_supplier,'doc_ref',v_docno,'invoice_ref',v_inv,'date',p_doc_date,'model',v_model,
    'qty',v_qty,'unit_cost',v_cost,'job',p_job,'house',v_house,'paid',v_paid,'bank_line',p_bank_line,'note',v_note,'attachment',v_att,'product',v_product);

  FOR i IN 1..2 LOOP
    v_old := NULL;
    IF v_ref IS NOT NULL THEN SELECT * INTO v_old FROM public.stock_intakes WHERE company_id = co AND source_ref = v_ref FOR UPDATE; END IF;
    IF v_old.id IS NOT NULL THEN
      IF v_old.kind <> 'unit_purchase' THEN RAISE EXCEPTION 'That source reference is already used for a different record' USING ERRCODE = '22023'; END IF;
      IF v_old.payment_status = 'paid' AND v_paid <> 'paid' THEN
        v_paid := 'paid';
        p_bank_line := coalesce(p_bank_line, v_old.bank_line_id);
        v_payload := v_payload || jsonb_build_object('paid', 'paid', 'bank_line', p_bank_line);
      END IF;
      IF v_old.payload = v_payload THEN
        PERFORM public._bot_audit(co, 'unit_purchase_skipped', 'stock_intakes', v_old.id, v_old.payload, v_old.payload);
        RETURN jsonb_build_object('result','skipped','id',v_old.id,'kind','unit_purchase','bucket',v_bucket,'review',v_old.review_needed);
      END IF;
      IF (v_old.payload->>'model') IS DISTINCT FROM v_model OR (v_old.payload->>'qty')::int IS DISTINCT FROM v_qty
         OR (v_old.payload->>'unit_cost')::numeric IS DISTINCT FROM v_cost
         OR (v_old.payload->>'job') IS DISTINCT FROM p_job::text OR (v_old.payload->>'house') IS DISTINCT FROM v_house::text THEN
        IF EXISTS (SELECT 1 FROM public.stock_units u WHERE u.intake_id = v_old.id AND u.returned_at IS NOT NULL)
           OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.intake_id = v_old.id AND m.kind IN ('allocate','return','use'))
           OR EXISTS (SELECT 1 FROM public.stock_intakes r WHERE r.linked_intake_id = v_old.id) THEN
          RAISE EXCEPTION 'These units have already moved. Book a return instead of changing the purchase.' USING ERRCODE = '22023';
        END IF;
        IF v_qty > coalesce((v_old.payload->>'qty')::int, 0) THEN
          v_stock := public._pool_item(co, v_model, v_cost);
          FOR n IN 1..(v_qty - (v_old.payload->>'qty')::int) LOOP
            INSERT INTO public.stock_units (company_id, stock_item_id, product_id, supplier_code, origin, received_job_id, project_house_id, unit_cost_excl, supplier_document_id, intake_id)
            VALUES (co, v_stock, v_product, v_model, v_origin, CASE WHEN v_origin = 'job_received' THEN v_job ELSE NULL END, CASE WHEN v_origin = 'job_received' THEN v_house ELSE NULL END, v_cost, v_old.supplier_document_id, v_old.id)
            RETURNING id INTO v_unit;
            PERFORM public._move_for_intake(co, v_old.id, 'receive', v_bucket, v_stock, v_product, v_model, 1, v_cost, CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, v_old.supplier_document_id, NULL, v_unit, 'Unit purchase', 0);
          END LOOP;
        ELSIF v_qty < coalesce((v_old.payload->>'qty')::int, 0) THEN
          n := (v_old.payload->>'qty')::int - v_qty;
          FOR v_unit IN
            SELECT u.id FROM public.stock_units u WHERE u.intake_id = v_old.id AND u.returned_at IS NULL ORDER BY u.created_at DESC LIMIT n
          LOOP
            PERFORM public._move_for_intake(co, v_old.id, 'return', v_bucket, (SELECT stock_item_id FROM public.stock_units WHERE id = v_unit), v_product, v_model, -1, v_cost, CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, v_old.supplier_document_id, NULL, v_unit, 'WALDA correction', 0);
            UPDATE public.stock_units SET returned_at = now() WHERE id = v_unit;
          END LOOP;
        END IF;
        IF v_cost IS DISTINCT FROM (v_old.payload->>'unit_cost')::numeric THEN
          PERFORM public._move_for_intake(co, v_old.id, 'adjust', v_bucket, public._pool_item(co, v_model, v_cost), v_product, v_model, 0, v_cost, CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, v_old.supplier_document_id, NULL, NULL, 'WALDA correction', round((v_cost - (v_old.payload->>'unit_cost')::numeric) * v_qty, 2));
        END IF;
      END IF;
      UPDATE public.stock_intakes SET supplier_name=v_supplier, doc_ref=coalesce(v_inv,v_docno), doc_date=p_doc_date, payment_status=v_paid,
        bank_line_id=p_bank_line, attachment_path=v_att, note=v_note, job_id=v_job, project_house_id=v_house, review_needed=v_review, payload=v_payload, updated_at=now()
      WHERE id = v_old.id;
      PERFORM public._bot_audit(co, 'unit_purchase_updated', 'stock_intakes', v_old.id, v_old.payload, v_payload);
      RETURN jsonb_build_object('result','updated','id',v_old.id,'kind','unit_purchase','bucket',v_bucket,'review',v_review,'product_id',v_product);
    END IF;
    BEGIN
      INSERT INTO public.stock_intakes (company_id, kind, source, source_ref, supplier_name, doc_ref, doc_date, payment_status, bank_line_id, attachment_path, job_id, project_house_id, note, review_needed, payload, created_by)
      VALUES (co, 'unit_purchase', 'walda', v_ref, v_supplier, coalesce(v_inv, v_docno), p_doc_date, v_paid, p_bank_line, v_att, v_job, v_house, v_note, v_review, v_payload, auth.uid())
      RETURNING id INTO v_id;
      v_doc := public._open_supplier_doc(co, 'walda', v_ref, v_supplier, 'supplier_invoice', coalesce(v_inv, v_docno), p_doc_date, v_att, v_note);
      v_stock := public._pool_item(co, v_model, v_cost);
      v_line := public._add_doc_line(v_doc, co, 1, v_model, v_model, v_qty, CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, v_cost, v_bucket);
      FOR n IN 1..v_qty LOOP
        INSERT INTO public.stock_units (company_id, stock_item_id, product_id, supplier_code, origin, received_job_id, project_house_id, unit_cost_excl, supplier_document_id, supplier_document_line_id, intake_id)
        VALUES (co, v_stock, v_product, v_model, v_origin, CASE WHEN v_origin = 'job_received' THEN v_job ELSE NULL END, CASE WHEN v_origin = 'job_received' THEN v_house ELSE NULL END, v_cost, v_doc, v_line, v_id)
        RETURNING id INTO v_unit;
        PERFORM public._move_for_intake(co, v_id, 'receive', v_bucket, v_stock, v_product, v_model, 1, v_cost, CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, v_doc, v_line, v_unit, 'Unit purchase', 0);
      END LOOP;
      UPDATE public.stock_intakes SET supplier_document_id = v_doc WHERE id = v_id;
      INSERT INTO public.stock_intake_lines (intake_id, company_id, line_kind, item_label, model_text, product_id, stock_item_id, qty, unit_name, unit_cost_excl, total_cost_excl, bucket, matched, review_needed)
      VALUES (v_id, co, 'unit', v_model, v_model, v_product, v_stock, v_qty, 'each', v_cost, round(v_cost * v_qty, 2), v_bucket, v_product IS NOT NULL, v_review);
      PERFORM public._bot_audit(co, 'unit_purchase_inserted', 'stock_intakes', v_id, NULL, v_payload);
      RETURN jsonb_build_object('result','inserted','id',v_id,'kind','unit_purchase','bucket',v_bucket,'review',v_review,'product_id',v_product,'qty',v_qty);
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the unit purchase';
END $$;

CREATE OR REPLACE FUNCTION public.walda_allocate_unit(
  p_source_ref text, p_unit uuid DEFAULT NULL, p_purchase_ref text DEFAULT NULL,
  p_job uuid DEFAULT NULL, p_project_house uuid DEFAULT NULL, p_qty numeric DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  co uuid := public._walda_co();
  v_ref text := nullif(btrim(p_source_ref),'');
  v_job uuid := p_job; v_house uuid := p_project_house; v_qty int; v_payload jsonb;
  v_old public.stock_intakes%ROWTYPE; v_id uuid; v_unit uuid; v_n int := 0; v_transfer uuid; i int;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF v_ref IS NULL THEN RAISE EXCEPTION 'Source reference is required' USING ERRCODE = '22023'; END IF;
  IF length(v_ref) > 120 THEN RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023'; END IF;
  IF p_unit IS NULL AND nullif(btrim(p_purchase_ref),'') IS NULL THEN RAISE EXCEPTION 'Give a unit or the purchase source reference' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty <> trunc(p_qty) OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be a whole number' USING ERRCODE = '22023'; END IF;
  v_qty := p_qty::int;
  IF p_job IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.company_id = co) THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501'; END IF;
  IF p_project_house IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.project_houses h WHERE h.id = p_project_house AND h.company_id = co) THEN RAISE EXCEPTION 'Project house not found' USING ERRCODE = '42501'; END IF;
  IF v_job IS NULL AND v_house IS NOT NULL THEN v_job := public._house_install_job(co, v_house); END IF;
  IF v_job IS NULL AND v_house IS NULL THEN RAISE EXCEPTION 'Give a job or a project house' USING ERRCODE = '22023'; END IF;
  v_payload := jsonb_build_object('unit', p_unit, 'purchase_ref', nullif(btrim(p_purchase_ref),''), 'job', v_job, 'house', v_house, 'qty', v_qty);
  FOR i IN 1..2 LOOP
    SELECT * INTO v_old FROM public.stock_intakes WHERE company_id = co AND source_ref = v_ref FOR UPDATE;
    IF FOUND THEN
      IF v_old.payload = v_payload THEN
        PERFORM public._bot_audit(co, 'unit_allocate_skipped', 'stock_intakes', v_old.id, v_old.payload, v_old.payload);
        RETURN jsonb_build_object('result','skipped','id',v_old.id,'kind','allocate','job_id',v_old.job_id);
      END IF;
      RAISE EXCEPTION 'This allocation is already booked. Use a new source reference to change it.' USING ERRCODE = '22023';
    END IF;
    BEGIN
      INSERT INTO public.stock_intakes (company_id, kind, source, source_ref, job_id, project_house_id, payload, created_by)
      VALUES (co, 'allocate', 'walda', v_ref, v_job, v_house, v_payload, auth.uid()) RETURNING id INTO v_id;
      FOR v_unit IN
        SELECT u.id FROM public.stock_units u
        LEFT JOIN public.stock_intakes src ON src.id = u.intake_id
        WHERE u.company_id = co AND u.returned_at IS NULL AND u.origin = 'general_stock'
          AND (p_unit IS NULL OR u.id = p_unit)
          AND (nullif(btrim(p_purchase_ref),'') IS NULL OR src.source_ref = btrim(p_purchase_ref) OR src.id::text = btrim(p_purchase_ref))
          AND coalesce((SELECT sum(m.qty) FROM public.stock_movements m WHERE m.unit_id = u.id AND m.kind = 'allocate' AND m.bucket = 'job_unit'), 0) = 0
        ORDER BY u.created_at LIMIT v_qty
      LOOP
        v_transfer := gen_random_uuid();
        PERFORM set_config('walda.intake_id', v_id::text, true);
        PERFORM public._stock_move(co, 'allocate', 'general_unit', (SELECT stock_item_id FROM public.stock_units WHERE id = v_unit), (SELECT product_id FROM public.stock_units WHERE id = v_unit),
          (SELECT supplier_code FROM public.stock_units WHERE id = v_unit), -1, (SELECT unit_cost_excl FROM public.stock_units WHERE id = v_unit), NULL, NULL, NULL, NULL, NULL, v_unit, 'Allocate to job', NULL, NULL, v_transfer, 0);
        PERFORM public._stock_move(co, 'allocate', 'job_unit', (SELECT stock_item_id FROM public.stock_units WHERE id = v_unit), (SELECT product_id FROM public.stock_units WHERE id = v_unit),
          (SELECT supplier_code FROM public.stock_units WHERE id = v_unit), 1, (SELECT unit_cost_excl FROM public.stock_units WHERE id = v_unit), NULL, v_job, NULL, NULL, NULL, v_unit, 'Allocate to job', NULL, NULL, v_transfer, 0);
        v_n := v_n + 1;
      END LOOP;
      IF v_n < v_qty THEN RAISE EXCEPTION 'Only % unallocated unit(s) match. Nothing was left half-done.', v_n USING ERRCODE = '22023'; END IF;
      PERFORM public._bot_audit(co, 'unit_allocate_inserted', 'stock_intakes', v_id, NULL, v_payload);
      RETURN jsonb_build_object('result','inserted','id',v_id,'kind','allocate','qty',v_n,'job_id',v_job,'house_id',v_house);
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not allocate the unit';
END $$;
CREATE OR REPLACE FUNCTION public.walda_link_purchase_payment(
  p_source_ref text DEFAULT NULL, p_purchase uuid DEFAULT NULL, p_bank_line uuid DEFAULT NULL, p_bank_line_ref text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  co uuid := public._walda_co();
  v_id uuid := p_purchase; v_line uuid := p_bank_line; v_ref text := nullif(btrim(p_bank_line_ref),'');
  v_old public.stock_intakes%ROWTYPE; v_n int;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF v_id IS NULL AND nullif(btrim(p_source_ref),'') IS NULL THEN RAISE EXCEPTION 'Give the purchase id or the source reference' USING ERRCODE = '22023'; END IF;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.stock_intakes WHERE company_id = co AND source_ref = btrim(p_source_ref);
  END IF;
  SELECT * INTO v_old FROM public.stock_intakes WHERE id = v_id AND company_id = co FOR UPDATE;
  IF v_old.id IS NULL OR v_old.kind NOT IN ('material_purchase','unit_purchase') THEN RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501'; END IF;
  IF v_line IS NULL AND v_ref IS NULL THEN RAISE EXCEPTION 'Give the bank line id or its reference' USING ERRCODE = '22023'; END IF;
  IF to_regclass('public.bank_lines') IS NOT NULL THEN
    IF v_line IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bank_lines b WHERE b.id = v_line AND b.company_id = co) THEN
      RAISE EXCEPTION 'Bank line not found' USING ERRCODE = '42501'; END IF;
    IF v_line IS NULL THEN
      SELECT count(*) INTO v_n FROM public.bank_lines b WHERE b.company_id = co AND btrim(coalesce(b.reference,'')) = v_ref;
      IF v_n = 0 THEN RAISE EXCEPTION 'Bank line not found' USING ERRCODE = '42501'; END IF;
      IF v_n > 1 THEN RAISE EXCEPTION 'More than one bank line matches that reference' USING ERRCODE = '22023'; END IF;
      SELECT b.id INTO v_line FROM public.bank_lines b WHERE b.company_id = co AND btrim(coalesce(b.reference,'')) = v_ref LIMIT 1;
    ELSIF v_ref IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.bank_lines b WHERE b.id = v_line AND b.company_id = co AND btrim(coalesce(b.reference,'')) = v_ref
    ) THEN
      RAISE EXCEPTION 'Bank line reference does not match that line' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_old.payment_status = 'paid' AND v_old.bank_line_id IS NOT DISTINCT FROM v_line THEN
    PERFORM public._bot_audit(co, 'purchase_payment_skipped', 'stock_intakes', v_old.id, to_jsonb(v_old), to_jsonb(v_old));
    RETURN jsonb_build_object('result','skipped','id',v_old.id,'payment_status','paid','bank_line_id',v_line);
  END IF;
  UPDATE public.stock_intakes SET payment_status = 'paid', bank_line_id = v_line,
    payload = payload || jsonb_build_object('paid','paid','bank_line',v_line), updated_at = now()
  WHERE id = v_old.id;
  PERFORM public._bot_audit(co, 'purchase_payment_updated', 'stock_intakes', v_old.id, to_jsonb(v_old), jsonb_build_object('payment_status','paid','bank_line_id',v_line));
  RETURN jsonb_build_object('result','updated','id',v_old.id,'payment_status','paid','bank_line_id',v_line);
END $$;

CREATE OR REPLACE FUNCTION public.walda_record_purchase_return(
  p_supplier text, p_credit_ref text, p_doc_date date, p_lines jsonb, p_purchase_ref text,
  p_bank_line uuid DEFAULT NULL, p_source_ref text DEFAULT NULL, p_note text DEFAULT NULL, p_attachment text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  co uuid := public._walda_co();
  v_supplier text := nullif(left(btrim(coalesce(p_supplier,'')),160),'');
  v_credit text := nullif(left(btrim(coalesce(p_credit_ref,'')),80),'');
  v_ref text := nullif(btrim(p_source_ref),'');
  v_note text := nullif(btrim(p_note),'');
  v_att text; v_src public.stock_intakes%ROWTYPE; v_old public.stock_intakes%ROWTYPE;
  v_payload jsonb; v_id uuid; v_doc uuid; v_line jsonb; v_no int := 0;
  v_kind text; v_label text; v_qty numeric; v_amt numeric; v_cost numeric; v_item uuid; v_open numeric; v_unit uuid; v_left int; i int;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF v_supplier IS NULL THEN RAISE EXCEPTION 'Supplier is required' USING ERRCODE = '22023'; END IF;
  IF v_credit IS NULL THEN RAISE EXCEPTION 'Credit note reference is required' USING ERRCODE = '22023'; END IF;
  IF p_doc_date IS NULL THEN RAISE EXCEPTION 'Date is required' USING ERRCODE = '22023'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'At least one line is required' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(p_purchase_ref),'') IS NULL THEN RAISE EXCEPTION 'Link the original purchase source reference' USING ERRCODE = '22023'; END IF;
  v_att := public._walda_attachment(p_attachment, co);
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_src FROM public.stock_intakes WHERE company_id = co AND source_ref = btrim(p_purchase_ref) AND kind IN ('material_purchase','unit_purchase');
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'Original purchase not found' USING ERRCODE = '42501'; END IF;
  IF p_bank_line IS NOT NULL AND to_regclass('public.bank_lines') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.bank_lines b WHERE b.id = p_bank_line AND b.company_id = co) THEN
    RAISE EXCEPTION 'Bank line not found' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('supplier',v_supplier,'credit_ref',v_credit,'date',p_doc_date,'lines',p_lines,'purchase_ref',btrim(p_purchase_ref),'bank_line',p_bank_line,'note',v_note,'attachment',v_att);

  FOR i IN 1..2 LOOP
    v_old := NULL;
    IF v_ref IS NOT NULL THEN SELECT * INTO v_old FROM public.stock_intakes WHERE company_id = co AND source_ref = v_ref FOR UPDATE; END IF;
    IF v_old.id IS NOT NULL THEN
      IF v_old.kind <> 'return' THEN RAISE EXCEPTION 'That source reference is already used for a different record' USING ERRCODE = '22023'; END IF;
      IF v_old.payload = v_payload THEN
        PERFORM public._bot_audit(co, 'purchase_return_skipped', 'stock_intakes', v_old.id, v_old.payload, v_old.payload);
        RETURN jsonb_build_object('result','skipped','id',v_old.id,'kind','return','linked_id',v_old.linked_intake_id);
      END IF;
      IF v_old.payload->'lines' IS DISTINCT FROM p_lines OR (v_old.payload->>'purchase_ref') IS DISTINCT FROM btrim(p_purchase_ref) THEN
        RAISE EXCEPTION 'This credit note is already booked. Use a new source reference to change the lines.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.stock_intakes SET note = v_note, attachment_path = v_att, bank_line_id = p_bank_line, payload = v_payload, updated_at = now() WHERE id = v_old.id;
      PERFORM public._bot_audit(co, 'purchase_return_updated', 'stock_intakes', v_old.id, v_old.payload, v_payload);
      RETURN jsonb_build_object('result','updated','id',v_old.id,'kind','return','linked_id',v_src.id);
    END IF;
    BEGIN
      INSERT INTO public.stock_intakes (company_id, kind, source, source_ref, supplier_name, doc_ref, doc_date, bank_line_id, attachment_path, note, linked_intake_id, payload, created_by)
      VALUES (co, 'return', 'walda', v_ref, v_supplier, v_credit, p_doc_date, p_bank_line, v_att, v_note, v_src.id, v_payload, auth.uid())
      RETURNING id INTO v_id;
      v_doc := public._open_supplier_doc(co, 'walda', coalesce(v_ref, v_id::text), v_supplier, 'credit_note', v_credit, p_doc_date, v_att, v_note);
      UPDATE public.stock_intakes SET supplier_document_id = v_doc WHERE id = v_id;
      FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_no := v_no + 1;
        v_kind := lower(coalesce(v_line->>'kind', CASE WHEN coalesce(v_line->>'model', v_line->>'model_or_size','') <> '' AND coalesce(v_line->>'item','') = '' THEN 'unit' ELSE 'material' END));
        v_label := coalesce(nullif(btrim(coalesce(v_line->>'item', v_line->>'model', v_line->>'model_or_size')), ''), '');
        v_qty := coalesce((v_line->>'qty')::numeric, 0);
        v_amt := coalesce((v_line->>'amount')::numeric, 0);
        IF v_label = '' OR v_qty <= 0 THEN RAISE EXCEPTION 'Each credit line needs an item and a quantity' USING ERRCODE = '22023'; END IF;
        v_cost := CASE WHEN v_amt > 0 THEN round(v_amt / v_qty, 4) ELSE NULL END;
        IF v_kind = 'unit' OR v_src.kind = 'unit_purchase' AND v_kind <> 'material' THEN
          v_left := trunc(v_qty)::int;
          FOR v_unit IN
            SELECT u.id FROM public.stock_units u
            WHERE u.intake_id = v_src.id AND u.returned_at IS NULL AND u.company_id = co
              AND (v_label = '' OR lower(coalesce(u.supplier_code,'')) = lower(v_label) OR u.supplier_code ILIKE '%' || v_label || '%')
            ORDER BY (coalesce((SELECT sum(m.qty) FROM public.stock_movements m WHERE m.unit_id = u.id AND m.kind = 'allocate' AND m.bucket = 'job_unit'),0) > 0) DESC, u.created_at
          LOOP
            EXIT WHEN v_left <= 0;
            IF coalesce((SELECT sum(m.qty) FROM public.stock_movements m WHERE m.unit_id = v_unit AND m.kind = 'allocate' AND m.bucket = 'job_unit'),0) > 0 THEN
              PERFORM set_config('walda.intake_id', v_id::text, true);
              PERFORM public._stock_move(co,'allocate','job_unit',(SELECT stock_item_id FROM stock_units WHERE id=v_unit),(SELECT product_id FROM stock_units WHERE id=v_unit),(SELECT supplier_code FROM stock_units WHERE id=v_unit),-1,(SELECT unit_cost_excl FROM stock_units WHERE id=v_unit),NULL,(SELECT job_id FROM stock_movements WHERE unit_id=v_unit AND kind='allocate' AND bucket='job_unit' AND qty>0 ORDER BY created_at DESC LIMIT 1),NULL,NULL,NULL,v_unit,'Unallocate before return',NULL,NULL,gen_random_uuid(),0);
              PERFORM public._stock_move(co,'allocate','general_unit',(SELECT stock_item_id FROM stock_units WHERE id=v_unit),(SELECT product_id FROM stock_units WHERE id=v_unit),(SELECT supplier_code FROM stock_units WHERE id=v_unit),1,(SELECT unit_cost_excl FROM stock_units WHERE id=v_unit),NULL,NULL,NULL,NULL,NULL,v_unit,'Unallocate before return',NULL,NULL,gen_random_uuid(),0);
            END IF;
            PERFORM public._move_for_intake(co, v_id, 'return', CASE WHEN (SELECT origin FROM stock_units WHERE id=v_unit)='job_received' THEN 'job_unit' ELSE 'general_unit' END,
              (SELECT stock_item_id FROM stock_units WHERE id=v_unit), (SELECT product_id FROM stock_units WHERE id=v_unit), v_label, -1, coalesce(v_cost,(SELECT unit_cost_excl FROM stock_units WHERE id=v_unit)),
              (SELECT received_job_id FROM stock_units WHERE id=v_unit), v_doc, NULL, v_unit, 'Credit note '||v_credit, 0);
            UPDATE public.stock_units SET returned_at = now() WHERE id = v_unit;
            v_left := v_left - 1;
          END LOOP;
          IF v_left > 0 THEN RAISE EXCEPTION 'Credit of % is more than the units still in stock for %', v_qty, v_label USING ERRCODE = '22023'; END IF;
        ELSE
          v_item := public._pool_item(co, v_label, v_cost);
          SELECT coalesce(sum(m.qty),0) INTO v_open FROM public.stock_movements m
          WHERE m.company_id = co AND m.stock_item_id = v_item AND m.bucket = 'material_pool';
          IF v_qty > v_open + 0.0001 THEN RAISE EXCEPTION 'Credit of % is more than the % still in the materials pool', v_qty, v_open USING ERRCODE = '22023'; END IF;
          PERFORM public._move_for_intake(co, v_id, 'return', 'material_pool', v_item, NULL, v_label, -v_qty, coalesce(v_cost, 0), NULL, v_doc, NULL, NULL, 'Credit note '||v_credit, 0);
          UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - v_qty), updated_at = now() WHERE id = v_item;
        END IF;
        INSERT INTO public.stock_intake_lines (intake_id, company_id, line_no, line_kind, item_label, qty, total_cost_excl, bucket)
        VALUES (v_id, co, v_no, CASE WHEN v_kind = 'unit' THEN 'unit' ELSE 'material' END, v_label, v_qty, v_amt, CASE WHEN v_kind = 'unit' THEN 'general_unit' ELSE 'material_pool' END);
      END LOOP;
      PERFORM public._bot_audit(co, 'purchase_return_inserted', 'stock_intakes', v_id, NULL, v_payload);
      RETURN jsonb_build_object('result','inserted','id',v_id,'kind','return','linked_id',v_src.id,'credit_ref',v_credit);
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the credit note';
END $$;

CREATE OR REPLACE FUNCTION public.walda_record_direct_delivery(
  p_supplier text, p_order_ref text, p_client text DEFAULT NULL, p_customer uuid DEFAULT NULL,
  p_job uuid DEFAULT NULL, p_project_house uuid DEFAULT NULL, p_units jsonb DEFAULT '[]'::jsonb,
  p_doc_date date DEFAULT NULL, p_note text DEFAULT NULL, p_attachment text DEFAULT NULL, p_source_ref text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  co uuid := public._walda_co();
  v_supplier text := nullif(left(btrim(coalesce(p_supplier,'')),160),'');
  v_order text := nullif(left(btrim(coalesce(p_order_ref,'')),80),'');
  v_client text := nullif(left(btrim(coalesce(p_client,'')),200),'');
  v_note text := nullif(btrim(p_note),'');
  v_ref text := nullif(btrim(p_source_ref),'');
  v_att text; v_job uuid := p_job; v_payload jsonb; v_old public.stock_intakes%ROWTYPE; v_id uuid; v_summary text; i int;
  v_before int; v_after int;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  IF v_supplier IS NULL THEN RAISE EXCEPTION 'Supplier is required' USING ERRCODE = '22023'; END IF;
  IF v_order IS NULL THEN RAISE EXCEPTION 'Order reference is required' USING ERRCODE = '22023'; END IF;
  IF p_doc_date IS NULL THEN RAISE EXCEPTION 'Date is required' USING ERRCODE = '22023'; END IF;
  IF v_client IS NULL AND p_customer IS NULL AND p_job IS NULL AND p_project_house IS NULL THEN
    RAISE EXCEPTION 'Give a client, a job or a project house' USING ERRCODE = '22023'; END IF;
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' OR jsonb_array_length(p_units) = 0 THEN RAISE EXCEPTION 'List the units' USING ERRCODE = '22023'; END IF;
  v_att := public._walda_attachment(p_attachment, co);
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023'; END IF;
  IF p_job IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.company_id = co) THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501'; END IF;
  IF p_customer IS NOT NULL AND to_regclass('public.customers') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = p_customer AND c.company_id = co) THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = '42501'; END IF;
  IF p_project_house IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.project_houses h WHERE h.id = p_project_house AND h.company_id = co) THEN
    RAISE EXCEPTION 'Project house not found' USING ERRCODE = '42501'; END IF;
  IF v_job IS NULL AND p_project_house IS NOT NULL THEN v_job := public._house_install_job(co, p_project_house); END IF;
  v_payload := jsonb_build_object('supplier',v_supplier,'order_ref',v_order,'client',v_client,'customer',p_customer,'job',v_job,'house',p_project_house,'units',p_units,'date',p_doc_date,'note',v_note,'attachment',v_att);
  v_summary := v_supplier || ' ' || v_order || '. Client paid the supplier. Not taken into stock.';

  FOR i IN 1..2 LOOP
    v_old := NULL;
    IF v_ref IS NOT NULL THEN SELECT * INTO v_old FROM public.stock_intakes WHERE company_id = co AND source_ref = v_ref FOR UPDATE; END IF;
    IF v_old.id IS NOT NULL THEN
      IF v_old.kind <> 'direct_delivery' THEN RAISE EXCEPTION 'That source reference is already used for a different record' USING ERRCODE = '22023'; END IF;
      IF v_old.payload = v_payload THEN
        PERFORM public._bot_audit(co, 'direct_delivery_skipped', 'stock_intakes', v_old.id, v_old.payload, v_old.payload);
        RETURN jsonb_build_object('result','skipped','id',v_old.id,'kind','direct_delivery','stock',false,'job_id',v_old.job_id);
      END IF;
      IF v_old.payload->'units' IS DISTINCT FROM p_units OR (v_old.payload->>'order_ref') IS DISTINCT FROM v_order THEN
        RAISE EXCEPTION 'This direct delivery is already noted. Use a new source reference to change the units.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.stock_intakes SET note=v_note, attachment_path=v_att, payload=v_payload, updated_at=now() WHERE id=v_old.id;
      PERFORM public._bot_audit(co, 'direct_delivery_updated', 'stock_intakes', v_old.id, v_old.payload, v_payload);
      RETURN jsonb_build_object('result','updated','id',v_old.id,'kind','direct_delivery','stock',false,'job_id',v_old.job_id);
    END IF;
    BEGIN
      SELECT count(*) INTO v_before FROM public.stock_movements WHERE company_id = co;
      INSERT INTO public.stock_intakes (company_id, kind, source, source_ref, supplier_name, doc_ref, doc_date, attachment_path, job_id, project_house_id, customer_id, client_name, note, payload, created_by)
      VALUES (co, 'direct_delivery', 'walda', v_ref, v_supplier, v_order, p_doc_date, v_att, v_job, p_project_house, p_customer, v_client, v_note, v_payload, auth.uid())
      RETURNING id INTO v_id;
      INSERT INTO public.stock_intake_lines (intake_id, company_id, line_no, line_kind, item_label, model_text, qty, unit_name, total_cost_excl)
      SELECT v_id, co, ord, 'unit', coalesce(x->>'model', x->>'model_or_size', 'Unit'), coalesce(x->>'model', x->>'model_or_size'), coalesce((x->>'qty')::numeric, 1), 'each', 0
      FROM jsonb_array_elements(p_units) WITH ORDINALITY AS t(x, ord);
      IF v_job IS NOT NULL AND to_regclass('public.job_activity_log') IS NOT NULL THEN
        INSERT INTO public.job_activity_log (job_id, user_id, action, details)
        VALUES (v_job, auth.uid(), 'direct_delivery', jsonb_build_object('summary', v_summary, 'supplier', v_supplier, 'order_ref', v_order, 'units', p_units, 'note', v_note, 'attachment', v_att, 'intake_id', v_id));
      END IF;
      SELECT count(*) INTO v_after FROM public.stock_movements WHERE company_id = co;
      IF v_after <> v_before THEN RAISE EXCEPTION 'Direct delivery must not post stock'; END IF;
      PERFORM public._bot_audit(co, 'direct_delivery_inserted', 'stock_intakes', v_id, NULL, v_payload);
      RETURN jsonb_build_object('result','inserted','id',v_id,'kind','direct_delivery','stock',false,'cost',0,'job_id',v_job);
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the direct delivery';
END $$;

CREATE OR REPLACE FUNCTION public.walda_read_material_averages() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid := public._walda_co(); v jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'per', per, 'qty', qty, 'unit', unit_name) ORDER BY label, per), '[]'::jsonb)
  INTO v FROM public.material_pool_averages WHERE company_id = co;
  RETURN jsonb_build_object('company_id', co, 'averages', v);
END $$;

CREATE OR REPLACE FUNCTION public.save_material_average(p_id uuid, p_label text, p_per text, p_qty numeric, p_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid; v_id uuid; v_per text := lower(btrim(coalesce(p_per,''))); v_label text := nullif(btrim(p_label),'');
BEGIN
  IF to_regprocedure('public._stock_reject_bot()') IS NOT NULL THEN PERFORM public._stock_reject_bot(); END IF;
  co := public.caller_company_id();
  IF NOT public._cf_ok(co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_label IS NULL THEN RAISE EXCEPTION 'Label is required' USING ERRCODE = '22023'; END IF;
  IF v_per NOT IN ('metre','install') THEN RAISE EXCEPTION 'Per must be metre or install' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty < 0 THEN RAISE EXCEPTION 'Quantity is required' USING ERRCODE = '22023'; END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.material_pool_averages SET label=v_label, per=v_per, qty=p_qty, unit_name=coalesce(nullif(btrim(p_unit),''),'m'), updated_at=now()
    WHERE id=p_id AND company_id=co RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Average not found' USING ERRCODE = '42501'; END IF;
  ELSE
    INSERT INTO public.material_pool_averages (company_id, label, per, qty, unit_name)
    VALUES (co, v_label, v_per, p_qty, coalesce(nullif(btrim(p_unit),''),'m'))
    ON CONFLICT (company_id, label, per) DO UPDATE SET qty=EXCLUDED.qty, unit_name=EXCLUDED.unit_name, updated_at=now()
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.delete_material_average(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid;
BEGIN
  IF to_regprocedure('public._stock_reject_bot()') IS NOT NULL THEN PERFORM public._stock_reject_bot(); END IF;
  co := public.caller_company_id();
  IF NOT public._cf_ok(co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.material_pool_averages WHERE id = p_id AND company_id = co;
END $$;

CREATE OR REPLACE FUNCTION public.record_pool_used(p_label text, p_qty numeric, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid; v_item uuid; v_qty numeric; v_cost numeric; v_open numeric;
BEGIN
  IF to_regprocedure('public._stock_reject_bot()') IS NOT NULL THEN PERFORM public._stock_reject_bot(); END IF;
  co := public.caller_company_id();
  IF NOT public._cf_ok(co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_label),'') IS NULL THEN RAISE EXCEPTION 'Item is required' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than zero' USING ERRCODE = '22023'; END IF;
  v_qty := round(p_qty, 3);
  SELECT id INTO v_item FROM public.cf_stock_items WHERE company_id = co AND lower(item) = lower(btrim(p_label)) LIMIT 1;
  IF v_item IS NULL THEN RAISE EXCEPTION 'That item is not in the pool' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(qty),0) INTO v_open FROM public.stock_movements WHERE company_id = co AND stock_item_id = v_item AND bucket = 'material_pool';
  IF v_qty > v_open + 0.0001 THEN RAISE EXCEPTION 'Already used is more than the quantity on hand' USING ERRCODE = '22023'; END IF;
  v_cost := coalesce(public.material_avg_cost(v_item), 0);
  PERFORM public._move_for_intake(co, NULL, 'use', 'material_pool', v_item, NULL, btrim(p_label), -v_qty, v_cost, NULL, NULL, NULL, NULL, coalesce(nullif(btrim(p_note),''), 'Already used'), 0);
  UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - v_qty), updated_at = now() WHERE id = v_item;
  RETURN jsonb_build_object('item_id', v_item, 'qty', v_qty);
END $$;

CREATE OR REPLACE FUNCTION public.material_pool_on_hand() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE co uuid; v_lines jsonb; v_total numeric;
BEGIN
  co := public.caller_company_id();
  IF NOT public._cf_ok(co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', item_label, 'qty', qty, 'value', value, 'unit', '') ORDER BY item_label), '[]'::jsonb),
         coalesce(sum(value), 0)
  INTO v_lines, v_total
  FROM (
    SELECT m.item_label, round(sum(m.qty), 3) AS qty,
           round(sum(m.qty * coalesce(m.unit_cost_excl, 0) + coalesce(m.value_adjust, 0)), 2) AS value
    FROM public.stock_movements m
    WHERE m.company_id = co AND m.bucket = 'material_pool'
    GROUP BY m.item_label
    HAVING abs(sum(m.qty)) > 0.0001 OR abs(sum(coalesce(m.value_adjust,0))) > 0.001
  ) s;
  RETURN jsonb_build_object('total', coalesce(v_total, 0), 'lines', coalesce(v_lines, '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.walda_record_expected_money(numeric,date,text,text,uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_expected_money(numeric,date,text,text,uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_record_material_purchase(text,numeric,text,numeric,date,text,text,text,boolean,uuid,text,text,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_material_purchase(text,numeric,text,numeric,date,text,text,text,boolean,uuid,text,text,text,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.record_material_purchase(text,numeric,text,numeric,date,text,text,text,boolean,uuid,text,text,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_material_purchase(text,numeric,text,numeric,date,text,text,text,boolean,uuid,text,text,text,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_record_unit_purchase(text,text,date,text,numeric,numeric,uuid,uuid,text,boolean,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_unit_purchase(text,text,date,text,numeric,numeric,uuid,uuid,text,boolean,uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_allocate_unit(text,uuid,text,uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_allocate_unit(text,uuid,text,uuid,uuid,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_link_purchase_payment(text,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_link_purchase_payment(text,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_record_purchase_return(text,text,date,jsonb,text,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_purchase_return(text,text,date,jsonb,text,uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_record_direct_delivery(text,text,text,uuid,uuid,uuid,jsonb,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_direct_delivery(text,text,text,uuid,uuid,uuid,jsonb,date,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.walda_read_material_averages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_read_material_averages() TO authenticated;
REVOKE ALL ON FUNCTION public.save_material_average(uuid,text,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_material_average(uuid,text,text,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_material_average(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_material_average(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_pool_used(text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pool_used(text,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.material_pool_on_hand() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.material_pool_on_hand() TO authenticated;

ALTER TABLE public.stock_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_intake_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_pool_averages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_intakes, public.stock_intake_lines, public.material_pool_averages FROM anon, PUBLIC;
DROP POLICY IF EXISTS stock_intakes_admin ON public.stock_intakes;
CREATE POLICY stock_intakes_admin ON public.stock_intakes FOR ALL TO authenticated
  USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id));
DROP POLICY IF EXISTS stock_intake_lines_admin ON public.stock_intake_lines;
CREATE POLICY stock_intake_lines_admin ON public.stock_intake_lines FOR ALL TO authenticated
  USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id));
DROP POLICY IF EXISTS material_pool_averages_admin ON public.material_pool_averages;
CREATE POLICY material_pool_averages_admin ON public.material_pool_averages FOR ALL TO authenticated
  USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_intakes, public.stock_intake_lines, public.material_pool_averages TO authenticated;
GRANT ALL ON public.stock_intakes, public.stock_intake_lines, public.material_pool_averages TO service_role;

COMMENT ON FUNCTION public.walda_record_direct_delivery IS
  'Note only. A client paid the supplier (for example RKP). No stock movement and no cost. The note is written on the job timeline when a job is known.';
COMMENT ON FUNCTION public.walda_read_material_averages IS
  'Read-only. WALDA must not change material_pool_averages. Admins edit them with save_material_average.';
