-- Job purchase orders for units that are short and due to be installed.
-- Not applied by this change. Run it when the office is ready.
-- Reuses purchase_orders, purchase_order_items and the supplier order_emails / main_email / our_account_number fields.
-- One draft per supplier, same shape as create_draft_pos_for_invoice. Sets jobs.awaiting_stock when a draft is created.
-- Does not change quote status, invoice rows, quote items, or stock quantities.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_source_chk;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_source_chk
  CHECK (source IS NULL OR source IN ('job_shortage', 'invoice'));

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS quote_item_id uuid REFERENCES public.quote_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_orders_quote_idx ON public.purchase_orders(quote_id);
CREATE INDEX IF NOT EXISTS purchase_order_items_quote_item_idx ON public.purchase_order_items(quote_item_id);

COMMENT ON COLUMN public.purchase_orders.source IS
  'job_shortage: drafted from a job''s short units. invoice: the paid-invoice draft. Null on older rows.';
COMMENT ON COLUMN public.purchase_orders.sent_at IS
  'Set when the office presses Send PO. A draft has no sent_at.';

-- Office types one or more supplier addresses. They are merged into suppliers.order_emails
-- and copied onto the draft. The accounts mailbox is not stored as the supplier's address.
CREATE OR REPLACE FUNCTION public.set_supplier_order_emails(p_po uuid, p_emails text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_merged text[];
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po FOR UPDATE;
  IF v_po.id IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT public.po_office_ok(v_po.company_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_po.status <> 'draft' OR v_po.source IS DISTINCT FROM 'job_shortage' THEN
    RAISE EXCEPTION 'Emails can be saved on a draft job purchase order';
  END IF;
  SELECT coalesce(array_agg(DISTINCT email), '{}') INTO v_merged
    FROM (
      SELECT lower(trim(e)) AS email
        FROM unnest(coalesce((SELECT order_emails FROM public.suppliers WHERE id = v_po.supplier_id), '{}') || coalesce(p_emails, '{}')) AS e
       WHERE lower(trim(e)) ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
         AND lower(trim(e)) <> 'accounts@0800becool.co.za'
    ) s;
  IF v_merged IS NULL OR cardinality(v_merged) = 0 THEN
    RAISE EXCEPTION 'Enter at least one supplier email';
  END IF;
  UPDATE public.suppliers SET order_emails = v_merged, updated_at = now() WHERE id = v_po.supplier_id;
  UPDATE public.purchase_orders SET supplier_emails = v_merged, updated_at = now() WHERE id = v_po.id;
  RETURN v_merged;
END $$;

REVOKE ALL ON FUNCTION public.set_supplier_order_emails(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_order_emails(uuid, text[]) TO authenticated;

-- Short units on the accepted quote, one draft PO per supplier. Idempotent: a line already on a
-- non-cancelled PO for this job is left as it is (the card shows PO raised or Ordered).
CREATE OR REPLACE FUNCTION public.create_draft_pos_for_job(p_job uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_prof public.company_profiles%ROWTYPE;
  v_client text;
  r record;
  v_on numeric;
  v_unit_rows int;
  v_ordered numeric;
  v_short numeric;
  v_po uuid;
  v_seq int;
  v_num text;
  v_emails text[];
  v_sub numeric;
  v_try int;
  v_made int := 0;
  v_missing jsonb := '[]'::jsonb;
  v_orders jsonb;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT public.po_office_ok(v_job.company_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_job.quote_id IS NULL THEN RAISE EXCEPTION 'This job has no quote'; END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE id = v_job.quote_id;
  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_quote.company_id IS DISTINCT FROM v_job.company_id THEN
    RAISE EXCEPTION 'Quote is not in this company' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_quote.status = 'accepted' OR v_quote.accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Purchase orders are for an accepted quote';
  END IF;
  -- The quote row is only read. Status, totals and lines stay as they are.

  SELECT c.name INTO v_client
    FROM public.customers c
   WHERE c.id = v_job.customer_id AND c.company_id = v_job.company_id;
  SELECT * INTO v_prof FROM public.company_profiles
   WHERE id = public.default_company_profile(v_job.company_id);

  PERFORM pg_advisory_xact_lock(hashtext('unit-po'), hashtext(v_job.company_id::text));

  FOR r IN
    SELECT qi.id AS quote_item_id, qi.quantity, qi.item_name, qi.sort_order,
           sp.id AS product_id, sp.supplier_id, sp.product_code,
           sp.short_name, sp.description, sp.cost_price
      FROM public.quote_items qi
      JOIN public.supplier_products sp ON sp.id = qi.product_id
     WHERE qi.quote_id = v_quote.id
       AND coalesce(qi.quantity, 0) > 0
       AND sp.supplier_id IS NOT NULL
       AND (
         sp.product_type = 'ac_unit'
         OR coalesce(qi.item_name, '') ~* '(indoor|outdoor|cassette|midwall|mid-wall|console|condenser|evaporator|split unit)'
       )
     ORDER BY qi.sort_order NULLS LAST, qi.id
  LOOP
    IF EXISTS (
      SELECT 1
        FROM public.purchase_order_items poi
        JOIN public.purchase_orders po ON po.id = poi.po_id
       WHERE po.job_id = v_job.id
         AND po.company_id = v_job.company_id
         AND po.status <> 'cancelled'
         AND (poi.quote_item_id = r.quote_item_id OR poi.product_id = r.product_id)
    ) THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_unit_rows
      FROM public.stock_units
     WHERE company_id = v_job.company_id AND product_id = r.product_id;
    IF v_unit_rows = 0 THEN
      SELECT coalesce(sum(greatest(qty_on_hand, 0)), 0) INTO v_on
        FROM public.cf_stock_items
       WHERE company_id = v_job.company_id AND product_id = r.product_id AND active;
    ELSE
      SELECT count(*)::numeric INTO v_on
        FROM public.stock_units su
       WHERE su.company_id = v_job.company_id
         AND su.product_id = r.product_id
         AND (
           su.received_job_id = v_job.id
           OR (
             su.origin = 'general_stock'
             AND NOT EXISTS (
               SELECT 1 FROM public.stock_movements m
                WHERE m.unit_id = su.id
                  AND m.kind = 'allocate'
                  AND m.bucket = 'job_unit'
                  AND m.qty > 0
             )
           )
         );
    END IF;

    SELECT coalesce(sum(poi.qty), 0) INTO v_ordered
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.po_id
     WHERE po.job_id = v_job.id
       AND po.company_id = v_job.company_id
       AND po.status <> 'cancelled'
       AND (poi.quote_item_id = r.quote_item_id OR poi.product_id = r.product_id);
    v_short := round(r.quantity - coalesce(v_on, 0) - coalesce(v_ordered, 0), 3);
    IF v_short <= 0 THEN CONTINUE; END IF;
    IF r.cost_price IS NULL OR r.cost_price <= 0 THEN
      v_missing := v_missing || jsonb_build_object(
        'quote_item_id', r.quote_item_id,
        'code', r.product_code,
        'description', coalesce(nullif(r.short_name, ''), r.item_name));
      CONTINUE;
    END IF;

    SELECT id INTO v_po
      FROM public.purchase_orders
     WHERE job_id = v_job.id
       AND company_id = v_job.company_id
       AND supplier_id = r.supplier_id
       AND status = 'draft'
       AND source = 'job_shortage'
     LIMIT 1;

    IF v_po IS NULL THEN
      SELECT CASE
               WHEN cardinality(order_emails) > 0 THEN order_emails
               WHEN main_email IS NOT NULL AND length(trim(main_email)) > 0 THEN ARRAY[lower(trim(main_email))]
               ELSE '{}'::text[]
             END
        INTO v_emails
        FROM public.suppliers WHERE id = r.supplier_id;
      v_po := NULL;
      FOR v_try IN 1..5 LOOP
        BEGIN
          SELECT coalesce(max(seq), 0) + 1 INTO v_seq
            FROM public.purchase_orders WHERE company_id = v_job.company_id;
          v_num := 'PO-' || regexp_replace(coalesce(v_quote.quote_number, 'JOB'), '[^A-Za-z0-9-]', '', 'g')
                   || '-' || lpad(v_seq::text, 2, '0');
          INSERT INTO public.purchase_orders (
            company_id, supplier_id, po_number, seq, status, source, quote_id, job_id, customer_id,
            client_name, job_reference, supplier_account_number, supplier_emails, deliver_to, notes
          )
          SELECT v_job.company_id, su.id, v_num, v_seq, 'draft', 'job_shortage', v_quote.id, v_job.id, v_job.customer_id,
                 coalesce(v_client, v_quote.customer_name),
                 coalesce(nullif(v_job.title, ''), v_quote.quote_number),
                 su.our_account_number,
                 coalesce(v_emails, '{}'::text[]),
                 nullif(array_to_string(v_prof.address_lines, ', '), ''),
                 'Send invoices and delivery notes to: accounts@0800becool.co.za'
            FROM public.suppliers su
           WHERE su.id = r.supplier_id
          RETURNING id INTO v_po;
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          v_po := NULL;
        END;
      END LOOP;
      IF v_po IS NULL THEN RAISE EXCEPTION 'Could not number the purchase order'; END IF;
      v_made := v_made + 1;
    END IF;

    INSERT INTO public.purchase_order_items (
      po_id, product_id, quote_item_id, model_code, description, qty,
      unit_cost_excl_vat, line_total_excl_vat, sort_order
    ) VALUES (
      v_po, r.product_id, r.quote_item_id, r.product_code,
      coalesce(nullif(r.short_name, ''), nullif(r.description, ''), r.item_name),
      v_short, round(r.cost_price, 2), round(r.cost_price * v_short, 2), coalesce(r.sort_order, 0)
    );
    SELECT coalesce(sum(line_total_excl_vat), 0) INTO v_sub
      FROM public.purchase_order_items WHERE po_id = v_po;
    UPDATE public.purchase_orders
       SET subtotal = v_sub,
           vat_amount = round(v_sub * 0.15, 2),
           total = v_sub + round(v_sub * 0.15, 2),
           updated_at = now()
     WHERE id = v_po;
  END LOOP;

  IF v_made > 0 THEN
    UPDATE public.jobs SET awaiting_stock = true WHERE id = v_job.id AND company_id = v_job.company_id;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', po.id,
           'po_number', po.po_number,
           'status', po.status,
           'sent_at', po.sent_at,
           'created_at', po.created_at,
           'supplier_id', po.supplier_id,
           'supplier_name', su.name,
           'supplier_emails', po.supplier_emails,
           'supplier_account_number', po.supplier_account_number,
           'client_name', po.client_name,
           'job_reference', po.job_reference,
           'notes', po.notes,
           'subtotal', po.subtotal,
           'vat_amount', po.vat_amount,
           'total', po.total,
           'lines', (
             SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'model_code', poi.model_code,
                      'description', poi.description,
                      'qty', poi.qty,
                      'unit_cost_excl_vat', poi.unit_cost_excl_vat,
                      'line_total_excl_vat', poi.line_total_excl_vat,
                      'quote_item_id', poi.quote_item_id,
                      'product_id', poi.product_id
                    ) ORDER BY poi.sort_order), '[]'::jsonb)
               FROM public.purchase_order_items poi
              WHERE poi.po_id = po.id
           )
         )), '[]'::jsonb)
    INTO v_orders
    FROM public.purchase_orders po
    JOIN public.suppliers su ON su.id = po.supplier_id
   WHERE po.job_id = v_job.id
     AND po.company_id = v_job.company_id
     AND po.status <> 'cancelled'
     AND po.source = 'job_shortage';

  RETURN jsonb_build_object('purchase_orders', v_orders, 'missing_price', v_missing);
END $$;

REVOKE ALL ON FUNCTION public.create_draft_pos_for_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_pos_for_job(uuid) TO authenticated;
