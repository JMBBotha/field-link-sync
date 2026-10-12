-- Rollback invoicing release 1 (DB). Restores the original functions, drops new objects; invoices keep their rows.
BEGIN;
DROP TRIGGER IF EXISTS trg_invoice_guard ON public.invoices;
DROP TRIGGER IF EXISTS trg_invoice_items_lock ON public.invoice_items;
DROP FUNCTION IF EXISTS public.trg_invoice_guard();
DROP FUNCTION IF EXISTS public.trg_invoice_items_lock();
DROP FUNCTION IF EXISTS public.duplicate_invoice(uuid);
DROP FUNCTION IF EXISTS public.next_invoice_number(uuid);
DROP FUNCTION IF EXISTS public.company_profile_snapshot(uuid);
DROP FUNCTION IF EXISTS public.default_company_profile(uuid);
CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  q public.quotes%ROWTYPE;
  cust record;
  v_existing uuid;
  v_pct numeric; v_frac numeric; v_number text;
  v_subtotal numeric; v_vat numeric; v_total numeric; v_rate numeric;
  v_agent uuid; v_id uuid;
  v_email text;
BEGIN
  PERFORM public.rh_assert(false); /*rh1*/
  PERFORM pg_advisory_xact_lock(hashtextextended('deposit_invoice:' || p_quote_id::text, 0));

  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not authorized for this quote' USING ERRCODE = '42501'; END IF; /*xco*/

  SELECT id INTO v_existing FROM public.invoices WHERE quote_id = q.id ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(default_deposit_percentage, 70) INTO v_pct
  FROM public.company_settings ORDER BY (company_id IS NOT DISTINCT FROM q.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p4cs*/
  v_pct := COALESCE(v_pct, 70);
  IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 70; END IF;
  IF public.payment_plan_ok(q.payment_plan) AND q.payment_plan IS NOT NULL THEN v_pct := (q.payment_plan->'stages'->0->>'pct')::numeric; END IF; /*acct1*/
  v_frac := v_pct / 100.0;

  v_subtotal := ROUND(COALESCE(q.subtotal, 0) * v_frac, 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0) * v_frac, 2);
  v_total := ROUND(COALESCE(q.total, 0) * v_frac, 2);
  v_rate := COALESCE(q.vat_rate, 0.15);
  IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;

  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN RETURN NULL; END IF;

  v_number := public.generate_invoice_number();

  INSERT INTO public.invoices (
    quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total,
    due_date, status, line_items, company_id, notes
  ) VALUES (
    q.id, q.lead_id, v_agent, q.customer_id,
    COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_subtotal, v_rate, v_vat, v_total,
    CURRENT_DATE + 30, 'draft',
    jsonb_build_array(jsonb_build_object(
      'description', 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
      'quantity', 1, 'rate', v_subtotal, 'amount', v_subtotal)),
    q.company_id,
    'DEPOSIT — ' || ROUND(v_pct)::text || '% of quote ' || COALESCE(q.quote_number, '') || '. Balance invoiced on completion.'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id, 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
    1, v_subtotal, v_subtotal);

  -- Auto-send (insert branch only)
  v_email := NULLIF(trim(COALESCE(cust.email, '')), '');
  IF v_email IS NOT NULL THEN
    PERFORM set_config('app.invoice_send_trigger', 'accept_auto', true);
    UPDATE public.invoices
       SET status = 'sent', issue_date = COALESCE(issue_date, CURRENT_DATE)
     WHERE id = v_id;
    PERFORM set_config('app.invoice_send_trigger', '', true);
  ELSE
    INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
    VALUES (gen_random_uuid()::text, 'invoice_email_skipped_no_email', '', q.quote_number,
      jsonb_build_object('invoice_id', v_id, 'invoice_number', v_number, 'trigger', 'accept_auto'));

    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    SELECT u, 'deposit_invoice_not_emailed', 'Deposit invoice not emailed — no client email',
      'Invoice ' || v_number || ' for quote ' || COALESCE(q.quote_number, '') || ' was not emailed because the client has no email address. Share the pay link by WhatsApp or copy.',
      v_id, jsonb_build_object('invoice_id', v_id, 'quote_id', q.id)
    FROM (
      SELECT q.sales_engineer_id AS u WHERE q.sales_engineer_id IS NOT NULL
      UNION
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE q.sales_engineer_id IS NULL AND ur.role = 'admin' AND p.company_id = q.company_id
    ) t;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_quote(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_settings public.company_settings%ROWTYPE;
BEGIN
  IF p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE public_token = p_token;
  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_quote.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_quote.customer_id;
  END IF;

  SELECT * INTO v_settings FROM public.company_settings ORDER BY (company_id IS NOT DISTINCT FROM v_quote.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/
  v_settings.default_deposit_percentage := (SELECT default_deposit_percentage FROM public.company_settings ORDER BY (company_id IS NOT DISTINCT FROM v_quote.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1); /*acctdep: same row as create_deposit_invoice_for_quote*/

  RETURN jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'status', v_quote.status,
      'subtotal', v_quote.subtotal,
      'vat_rate', v_quote.vat_rate,
      'vat_amount', v_quote.vat_amount,
      'total', v_quote.total,
      'notes', v_quote.notes,
      'valid_until', v_quote.valid_until,
      'created_at', v_quote.created_at,
      'accepted_by', v_quote.accepted_by,
      'customer_name', v_quote.customer_name,
      'terms_text', v_quote.terms_text,
      'reference_text', v_quote.reference_text,
      'discount_type', v_quote.discount_type,
      'discount_value', v_quote.discount_value, 'payment_plan', v_quote.payment_plan /*acct1*/
    ),
    'customer', CASE WHEN v_cust.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(COALESCE(v_cust.first_name,'') || ' ' || COALESCE(v_cust.last_name,'')), ''), v_cust.name),
      'company_name', v_cust.company_name,
      'address', v_cust.primary_address_line1,
      'email', v_cust.email,
      'phone', v_cust.phone
    ) END,
    'company', CASE WHEN v_settings.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_name', v_settings.company_name,
      'physical_address', v_settings.physical_address,
      'vat_number', v_settings.vat_number,
      'banking_details', v_settings.banking_details,
      'default_deposit_percentage', v_settings.default_deposit_percentage,
      'default_payment_terms_days', v_settings.default_payment_terms_days
    ) END,
    'areas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qa.id,
        'name', qa.name,
        'sort_order', qa.sort_order
      ) ORDER BY qa.sort_order NULLS LAST, qa.created_at)
      FROM public.quote_areas qa
      WHERE qa.quote_id = v_quote.id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qi.id,
        'item_name', qi.item_name,
        'description', qi.description,
        'quantity', qi.quantity,
        'unit_price', qi.unit_price,
        'total_price', qi.total_price,
        'sort_order', qi.sort_order,
        'product_id', qi.product_id,
        'area_id', qi.area_id,
        'area_name', qa.name,
        'item_type', qi.item_type,
        'image_url', sp.image_url,
        'category', sp.category,
        'brand', sp.brand,
        'btu_rating', sp.btu_rating,
        'capacity_btu', sp.capacity_btu,
        'kw', sp.kw,
        'ai_sales_description', sp.ai_sales_description,
        'item_number', qi.item_number,
        'is_bundle', qi.is_bundle,
        'product_code', sp.product_code
      ) ORDER BY qi.sort_order)
      FROM public.quote_items qi
      LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
      LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id
      WHERE qi.quote_id = v_quote.id AND qi.parent_item_id IS NULL
    ), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ps.id,
        'section_type', ps.section_type,
        'title', ps.title,
        'content', ps.content,
        'sort_order', ps.sort_order
      ) ORDER BY ps.sort_order)
      FROM public.proposal_sections ps
      WHERE ps.quote_id = v_quote.id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._customer_statement_build(p_customer uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.customers%ROWTYPE; v_open numeric; v_rows jsonb; v_close numeric; s record;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  WITH inv AS (
    SELECT i.* FROM public.invoices i
    WHERE i.company_id IS NOT DISTINCT FROM c.company_id
      AND (i.customer_id = c.id OR (i.customer_id IS NULL AND lower(btrim(i.customer_name)) = lower(btrim(c.name))))
      AND COALESCE(i.status, 'draft') NOT IN ('draft', 'void', 'cancelled')
  ), tx AS (
    SELECT COALESCE(i.issue_date, i.created_at::date) d, 1 k, 'invoice' t, i.invoice_number ref,
           COALESCE(NULLIF(i.line_items->0->>'description', ''), 'Invoice') descr, COALESCE(i.grand_total, 0) debit, 0::numeric credit, i.id inv_id, i.created_at ts
      FROM inv i
    UNION ALL
    SELECT COALESCE(p.payment_date::date, p.created_at::date), 2, 'payment', inv.invoice_number,
           'Payment' || COALESCE(' (' || NULLIF(p.method, '') || ')', ''), 0, COALESCE(p.amount, 0), inv.id, p.created_at
      FROM public.payments p JOIN inv ON inv.id = p.invoice_id
     WHERE p.status IN ('paid', 'succeeded', 'completed')
    UNION ALL
    SELECT cn.issue_date, 3, 'credit_note', cn.credit_note_number,
           'Credit note on ' || inv.invoice_number || COALESCE(' — ' || NULLIF(cn.description, ''), ''), 0, cn.total, inv.id, cn.created_at
      FROM public.credit_notes cn JOIN inv ON inv.id = cn.invoice_id
     WHERE cn.status = 'issued'
  ), ord AS (
    SELECT tx.*, SUM(debit - credit) OVER (ORDER BY d, k, ts, ref ROWS UNBOUNDED PRECEDING) run FROM tx
  )
  SELECT COALESCE((SELECT SUM(debit - credit) FROM tx WHERE d < p_from), 0),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'type', t, 'ref', ref, 'description', descr, 'debit', debit, 'credit', credit, 'balance', ROUND(run, 2), 'invoice_id', inv_id) ORDER BY d, k, ts, ref) FROM ord WHERE d BETWEEN p_from AND p_to), '[]'::jsonb),
         COALESCE((SELECT SUM(debit - credit) FROM tx WHERE d <= p_to), 0)
    INTO v_open, v_rows, v_close;
  SELECT company_name, physical_address, vat_number, banking_details INTO s FROM public.company_settings
   ORDER BY (company_id IS NOT DISTINCT FROM c.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1;
  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', COALESCE(NULLIF(btrim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), c.name),
      'company_name', c.company_name, 'address', COALESCE(c.primary_address_line1, c.address), 'vat_number', c.vat_number),
    'company', jsonb_build_object('company_name', s.company_name, 'physical_address', s.physical_address, 'vat_number', s.vat_number, 'banking_details', s.banking_details),
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'opening_balance', ROUND(v_open, 2), 'closing_balance', ROUND(v_close, 2), 'rows', v_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.company_profile_safe()
 RETURNS TABLE(company_id uuid, company_name text, vat_number text, physical_address text, postal_address text, office_address text, logo_storage_path text, logo_url text, default_deposit_percentage numeric, default_payment_terms_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, COALESCE(NULLIF(cs.company_name,''), c.name), cs.vat_number, cs.physical_address, cs.postal_address,
         c.office_address, cs.logo_storage_path, c.logo_url,
         cs.default_deposit_percentage::numeric, cs.default_payment_terms_days::integer
  FROM public.profiles p
  JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN LATERAL (SELECT * FROM public.company_settings s WHERE s.company_id = c.id
                     ORDER BY s.updated_at DESC LIMIT 1) cs ON true
  WHERE p.id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.approve_invoice_request(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); r public.invoice_requests%ROWTYPE; l public.leads%ROWTYPE; v_inv uuid; inv public.invoices%ROWTYPE;
  e jsonb; v_price numeric; v_qty numeric; v_desc text; v_rate numeric; v_sub numeric; v_lines jsonb := '[]'::jsonb; v_hr numeric;
BEGIN
  IF v_uid IS NULL OR public.is_field_tech_only(v_uid) OR public.is_sales_rep(v_uid)
     OR NOT (public.has_role(v_uid,'admin'::app_role) OR public.has_role(v_uid,'dispatcher'::app_role)) THEN
    RAISE EXCEPTION 'Only the office can approve invoice requests';
  END IF;
  SELECT * INTO r FROM public.invoice_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT public.p4_co_ok(r.company_id) THEN RAISE EXCEPTION 'Invoice request not found'; END IF;
  IF r.status = 'approved' THEN RETURN r.invoice_id; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request was dismissed'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = r.lead_id;

  IF r.quote_id IS NOT NULL THEN v_inv := public._create_balance_invoice(r.quote_id); END IF;
  IF v_inv IS NULL THEN
    SELECT i.id INTO v_inv FROM public.invoices i
     WHERE (i.lead_id = r.lead_id OR (r.quote_id IS NOT NULL AND i.quote_id = r.quote_id))
       AND COALESCE(i.status,'') NOT IN ('void','cancelled') AND COALESCE(i.notes,'') NOT LIKE 'DEPOSIT%'
     ORDER BY (i.status = 'draft') DESC, i.created_at DESC LIMIT 1;
  END IF;
  IF v_inv IS NULL THEN
    INSERT INTO public.invoices (lead_id, quote_id, agent_id, customer_id, customer_name, customer_phone, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes)
    VALUES (l.id, r.quote_id, v_uid, l.customer_id, COALESCE(l.customer_name,''), COALESCE(l.customer_phone,''), l.customer_address,
      public.generate_invoice_number(), 0, 15, 0, 0, CURRENT_DATE + 30, 'draft', '[]'::jsonb, r.company_id,
      'From invoice request (' || CASE WHEN r.as_quoted THEN 'as quoted' ELSE 'changes' END || ')')
    RETURNING id INTO v_inv;
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = v_inv;

  IF NOT r.as_quoted THEN
    IF inv.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is already %, add the extras manually (or credit/re-issue)', inv.invoice_number, inv.status;
    END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(r.extra_items) LOOP
      v_qty := COALESCE((e->>'qty')::numeric, 0);
      CONTINUE WHEN v_qty <= 0;
      v_price := NULL;
      IF e->>'product_id' IS NOT NULL THEN
        SELECT o.sell_excl_vat INTO v_price FROM public.get_product_sell_options() o WHERE o.id = (e->>'product_id')::uuid;
      END IF;
      v_desc := 'Extra (tech): ' || COALESCE(e->>'name','Item') || CASE WHEN v_price IS NULL THEN ' – price needed' ELSE '' END;
      v_price := COALESCE(v_price, 0);
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_inv, v_desc, v_qty, v_price, round(v_qty * v_price, 2));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', v_qty, 'rate', v_price, 'amount', round(v_qty * v_price, 2)));
    END LOOP;
    IF r.extra_hours IS NOT NULL AND r.extra_hours > 0 THEN
      SELECT cs.default_hourly_rate INTO v_hr FROM public.company_settings cs WHERE cs.company_id = r.company_id
        ORDER BY cs.created_at DESC NULLS LAST LIMIT 1;
      v_hr := COALESCE(v_hr, 0);
      v_desc := 'Extra labour (tech): ' || r.extra_hours || ' h' || CASE WHEN v_hr = 0 THEN ' – rate needed' ELSE '' END;
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_inv, v_desc, r.extra_hours, v_hr, round(r.extra_hours * v_hr, 2));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', r.extra_hours, 'rate', v_hr, 'amount', round(r.extra_hours * v_hr, 2)));
    END IF;
    v_rate := COALESCE(inv.tax_rate, 15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_sub FROM public.invoice_items WHERE invoice_id = v_inv;
    UPDATE public.invoices SET line_items = COALESCE(line_items, '[]'::jsonb) || v_lines,
      subtotal = round(v_sub, 2), tax_amount = round(v_sub * v_rate / 100, 2), grand_total = round(v_sub * (1 + v_rate / 100), 2),
      notes = concat_ws(E'\n', notes, 'Tech extras added from invoice request ' || to_char(now(), 'YYYY-MM-DD') || ' – review prices before sending.'),
      updated_at = now()
    WHERE id = v_inv;
  END IF;

  UPDATE public.invoice_requests SET status = 'approved', invoice_id = v_inv, approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE id = r.id;
  RETURN v_inv;
END $function$;

ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS vat_amount, DROP CONSTRAINT IF EXISTS invoice_items_vat_15,
  DROP COLUMN IF EXISTS vat_rate, DROP COLUMN IF EXISTS sort_order, DROP COLUMN IF EXISTS room_label, DROP COLUMN IF EXISTS line_type, DROP COLUMN IF EXISTS line_name;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS duplicated_from, DROP COLUMN IF EXISTS profile_snapshot, DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS deposit_amount, DROP COLUMN IF EXISTS deposit_value, DROP COLUMN IF EXISTS deposit_type,
  DROP COLUMN IF EXISTS discount_amount, DROP COLUMN IF EXISTS discount_value, DROP COLUMN IF EXISTS discount_type,
  DROP COLUMN IF EXISTS billed_to_vat_number, DROP COLUMN IF EXISTS company_profile_id;
DROP TABLE IF EXISTS public.company_profiles;
DROP INDEX IF EXISTS public.company_settings_one_primary;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS is_primary;
-- Backups stay in schema backup_inv_20261012 (invoices, invoice_items, company_settings).
COMMIT;
