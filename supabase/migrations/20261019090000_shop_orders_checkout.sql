-- Website shop R-C (Johan 2026-10-19 06:26): online shop orders, paid IN FULL by card (Yoco), ships with live payments OFF.
-- D4: a failed / cancelled / abandoned payment creates NOTHING in Field Lynk; pending orders expire after 24 h.
-- On a verified Yoco payment.succeeded, fl_shop_finalize (service_role only, one transaction, idempotent) creates:
-- customer (match by phone in Massair), lead (website_shop, sales, assigned to the owner so it is not broadcast),
-- accepted remote quote (remote_quote_source website_shop: terms 12 with "refund your payment in full"), one area per
-- room (unit + standard install [+ 24K isolator]), a full-amount invoice + paid Yoco payment, an installation job ready
-- to schedule (site check applies via fl_job_needs_site_check) and an in-app notification to the owner.
CREATE TABLE IF NOT EXISTS public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  order_ref text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','finalized','expired','failed','cancelled','needs_review')),
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  contact jsonb NOT NULL,
  preferred jsonb,
  notes text,
  rooms jsonb NOT NULL,
  lines jsonb NOT NULL,
  subtotal_ex numeric(12,2) NOT NULL,
  vat_amount numeric(12,2) NOT NULL,
  total_incl numeric(12,2) NOT NULL CHECK (total_incl > 0),
  terms_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  yoco_checkout_id text UNIQUE,
  yoco_payment_id text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  paid_at timestamptz,
  finalized_at timestamptz,
  customer_id uuid, lead_id uuid, quote_id uuid, invoice_id uuid, job_id uuid, payment_id uuid,
  email_sent_at timestamptz,
  last_event jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS shop_orders_company_created ON public.shop_orders (company_id, created_at DESC);
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_orders FROM PUBLIC, anon;
DROP POLICY IF EXISTS shop_orders_admin_read ON public.shop_orders;
CREATE POLICY shop_orders_admin_read ON public.shop_orders FOR SELECT TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id));

-- Create a pending order from a server-priced cart (prices never come from the browser).
CREATE OR REPLACE FUNCTION public.fl_shop_order_create(p_company uuid, p_rooms jsonb, p_contact jsonb, p_preferred jsonb,
  p_notes text, p_terms_version text, p_environment text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_q jsonb; v_id uuid; v_ref text;
BEGIN
  UPDATE public.shop_orders SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
  IF coalesce(btrim(p_contact->>'name'), '') = '' OR length(regexp_replace(coalesce(p_contact->>'phone', ''), '\D', '', 'g')) < 9
     OR coalesce(p_contact->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(coalesce(btrim(p_contact->>'address'), '')) < 5 THEN
    RAISE EXCEPTION 'shop: name, phone, email and install address are required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_terms_version, '') = '' THEN RAISE EXCEPTION 'shop: terms must be accepted' USING ERRCODE = '22023'; END IF;
  v_q := public.fl_shop_quote(p_company, p_rooms, true);
  v_ref := 'WEB-' || to_char(now() AT TIME ZONE 'Africa/Johannesburg', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
  INSERT INTO public.shop_orders (company_id, order_ref, environment, contact, preferred, notes, rooms, lines, subtotal_ex, vat_amount, total_incl,
    terms_version, terms_accepted_at, ip_hash)
  VALUES (p_company, v_ref, CASE WHEN p_environment = 'live' THEN 'live' ELSE 'sandbox' END,
    jsonb_build_object('name', left(btrim(p_contact->>'name'), 120), 'phone', left(btrim(p_contact->>'phone'), 20),
      'email', lower(left(btrim(p_contact->>'email'), 160)), 'address', left(btrim(p_contact->>'address'), 300),
      'lat', nullif(p_contact->>'lat', '')::numeric, 'lng', nullif(p_contact->>'lng', '')::numeric),
    p_preferred, left(p_notes, 1000), p_rooms, v_q->'rooms', (v_q->>'subtotal_ex')::numeric, (v_q->>'vat')::numeric, (v_q->>'total_incl')::numeric,
    p_terms_version, now(), p_ip_hash)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'order_ref', v_ref, 'subtotal_ex', v_q->'subtotal_ex', 'vat', v_q->'vat', 'total_incl', v_q->'total_incl');
END $f$;

CREATE OR REPLACE FUNCTION public.fl_shop_order_set_checkout(p_order uuid, p_checkout_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  UPDATE public.shop_orders SET yoco_checkout_id = p_checkout_id WHERE id = p_order AND status = 'pending' AND yoco_checkout_id IS NULL;
$f$;

-- Record a non-success event (failed / cancelled): the order stays as it is (pending -> expires), nothing else is created.
CREATE OR REPLACE FUNCTION public.fl_shop_order_note_event(p_order uuid, p_event jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  UPDATE public.shop_orders SET last_event = p_event WHERE id = p_order AND status <> 'finalized';
$f$;

CREATE OR REPLACE FUNCTION public.fl_shop_finalize(p_order uuid, p_checkout_id text, p_gateway_payment_id text,
  p_amount_cents bigint, p_environment text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o public.shop_orders%ROWTYPE; v_owner uuid; v_cust uuid; v_lead uuid; v_quote uuid; v_token uuid; v_inv uuid; v_inv_no text;
  v_job uuid; v_pay uuid; v_area uuid; r jsonb; v_i int := 0; v_qtotal numeric; v_name text; v_phone text; v_first text; v_last text;
  v_desc text; v_inv_lines jsonb := '[]'::jsonb; v_rooms_txt text := ''; v_pref text; v_size_label text;
BEGIN
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order FOR UPDATE;
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'order_not_found'); END IF;
  IF o.status = 'finalized' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'order_ref', o.order_ref, 'invoice_id', o.invoice_id, 'quote_id', o.quote_id, 'job_id', o.job_id);
  END IF;
  IF o.environment IS DISTINCT FROM (CASE WHEN p_environment = 'live' THEN 'live' ELSE 'sandbox' END)
     OR (o.yoco_checkout_id IS NOT NULL AND p_checkout_id IS NOT NULL AND o.yoco_checkout_id <> p_checkout_id)
     OR p_amount_cents IS DISTINCT FROM round(o.total_incl * 100)::bigint THEN
    -- Money may have been taken but something doesn't match: create nothing, flag it for the owner.
    UPDATE public.shop_orders SET status = 'needs_review', last_event = p_payload,
      error = format('mismatch: env %s/%s checkout %s/%s amount %s/%s', o.environment, p_environment, o.yoco_checkout_id, p_checkout_id, round(o.total_incl * 100), p_amount_cents)
     WHERE id = o.id;
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    SELECT cm.user_id, 'shop_order_review', 'Online shop payment needs checking: ' || o.order_ref,
      'A card payment came in for ' || o.order_ref || ' but it did not match the order. Nothing was booked. Check it in Yoco.', o.id,
      jsonb_build_object('shop_order_id', o.id)
    FROM public.company_members cm WHERE cm.company_id = o.company_id AND cm.role = 'admin' AND cm.is_owner;
    RETURN jsonb_build_object('ok', false, 'error', 'mismatch', 'order_ref', o.order_ref);
  END IF;

  SELECT cm.user_id INTO v_owner FROM public.company_members cm WHERE cm.company_id = o.company_id AND cm.role = 'admin' AND cm.is_owner ORDER BY cm.user_id LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'shop: company has no owner'; END IF;

  v_name := o.contact->>'name';
  v_phone := regexp_replace(o.contact->>'phone', '[^0-9+]', '', 'g');
  IF v_phone ~ '^0\d{9}$' THEN v_phone := '+27' || substr(v_phone, 2); ELSIF v_phone ~ '^27\d{9}$' THEN v_phone := '+' || v_phone; END IF;
  v_first := split_part(v_name, ' ', 1); v_last := nullif(btrim(substr(v_name, length(v_first) + 1)), '');
  v_pref := nullif(concat_ws(' ', o.preferred->>'date', o.preferred->>'time'), '');

  -- Customer: same phone inside this company only.
  SELECT id INTO v_cust FROM public.customers WHERE company_id = o.company_id AND normalized_phone = public.normalize_phone(v_phone)
   ORDER BY created_at LIMIT 1;
  IF v_cust IS NULL THEN
    INSERT INTO public.customers (name, first_name, last_name, phone, email, address, primary_address_line1, latitude, longitude, status, company_id, lead_source, created_by)
    VALUES (v_name, v_first, v_last, v_phone, o.contact->>'email', o.contact->>'address', o.contact->>'address',
      (o.contact->>'lat')::numeric, (o.contact->>'lng')::numeric, 'active', o.company_id, 'website', v_owner)
    RETURNING id INTO v_cust;
  ELSE
    UPDATE public.customers SET email = o.contact->>'email' WHERE id = v_cust AND coalesce(email, '') = '';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(o.lines) LOOP
    v_rooms_txt := v_rooms_txt || format(E'\n- %s (%s): %s', r->>'label', r->>'size', r->'unit'->>'name');
  END LOOP;

  -- Lead: assigned to the owner (no broadcast / offer calls for a paid order).
  INSERT INTO public.leads (customer_name, customer_phone, customer_address, email, latitude, longitude, service_type, status, priority,
    notes, company_id, customer_id, source, primary_intent, assigned_agent_id, assignment_method, raw_payload)
  VALUES (v_name, v_phone, o.contact->>'address', o.contact->>'email', coalesce((o.contact->>'lat')::numeric, 0), coalesce((o.contact->>'lng')::numeric, 0),
    'New Installation', 'pending', 'medium',
    format(E'Online shop order %s, PAID IN FULL R %s incl VAT (Yoco).%s%s%s', o.order_ref, to_char(o.total_incl, 'FM999999990.00'), v_rooms_txt,
      CASE WHEN v_pref IS NOT NULL THEN E'\nRequested install time (not booked yet, confirm with the client): ' || v_pref ELSE '' END,
      CASE WHEN coalesce(o.notes, '') <> '' THEN E'\nClient notes: ' || o.notes ELSE '' END),
    o.company_id, v_cust, 'website_shop', 'sales', v_owner, 'manual',
    jsonb_build_object('source', 'website', 'form', 'shop', 'shop_order_id', o.id, 'order_ref', o.order_ref, 'requested', o.preferred))
  RETURNING id INTO v_lead;

  -- Accepted remote quote, one area per room.
  INSERT INTO public.quotes (customer_id, lead_id, sales_engineer_id, created_by, owner_id, status, accepted_at, accepted_by, accepted_signature,
    customer_name, company_id, vat_rate, valid_until, reference_text, notes, remote_quote, remote_quote_source, labour_included, labour_mode,
    sent_at, sent_method, sent_channel, sent_note, client_summary)
  VALUES (v_cust, v_lead, v_owner, v_owner, v_owner, 'accepted', now(), v_name,
    jsonb_build_object('method', 'online_shop', 'order_ref', o.order_ref, 'terms_version', o.terms_version, 'terms_accepted_at', o.terms_accepted_at, 'ip_hash', o.ip_hash),
    v_name, o.company_id, 0.15, current_date + 30, 'Online shop order ' || o.order_ref,
    'Ordered and paid in full online (' || o.order_ref || ').', true, 'website_shop', true, 'per_area',
    now(), 'manual', 'other', 'Online shop order, paid online', jsonb_array_length(o.lines) || ' room(s) supplied and installed')
  RETURNING id, public_token INTO v_quote, v_token;

  FOR r IN SELECT * FROM jsonb_array_elements(o.lines) LOOP
    v_i := v_i + 1;
    v_size_label := CASE r->>'size' WHEN 'S' THEN 'Small' WHEN 'M' THEN 'Medium' WHEN 'L' THEN 'Large' WHEN 'XL' THEN 'X-Large' ELSE r->>'size' END;
    INSERT INTO public.quote_areas (quote_id, name, sort_order, description)
    VALUES (v_quote, r->>'label', v_i, v_size_label || ' room, ' || ((r->>'btu')::int / 1000) || 'K BTU') RETURNING id INTO v_area;
    INSERT INTO public.quote_items (quote_id, area_id, item_name, item_number, description, unit_price, quantity, total_price, source, product_id, item_type, sort_order, metadata)
    VALUES (v_quote, v_area, r->'unit'->>'name', r->'unit'->>'sku', (SELECT string_agg(x, ' • ') FROM jsonb_array_elements_text(r->'unit'->'features') x),
      (r->'unit'->>'ex')::numeric, 1, (r->'unit'->>'ex')::numeric, 'catalog', (r->'internal'->'unit'->>'product_id')::uuid, 'product', 1,
      jsonb_build_object('quote_category', 'units', 'cost_excl', (r->'internal'->'unit'->>'cost_ex')::numeric, 'unit_cost', (r->'internal'->'unit'->>'cost_ex')::numeric, 'shop', true));
    INSERT INTO public.quote_items (quote_id, area_id, item_name, item_number, unit_price, quantity, total_price, source, product_id, item_type, sort_order, metadata)
    VALUES (v_quote, v_area, coalesce(r->'internal'->'install'->>'short_name', r->'install'->>'name'), r->'internal'->'install'->>'code',
      (r->'install'->>'ex')::numeric, 1, (r->'install'->>'ex')::numeric, 'catalog', (r->'internal'->'install'->>'product_id')::uuid, 'product', 2,
      jsonb_build_object('quote_category', 'labour', 'cost_excl', (r->'internal'->'install'->>'cost_ex')::numeric, 'unit_cost', (r->'internal'->'install'->>'cost_ex')::numeric, 'shop', true, 'fixed_install', true));
    IF r->'isolator' IS NOT NULL AND jsonb_typeof(r->'isolator') = 'object' THEN
      INSERT INTO public.quote_items (quote_id, area_id, item_name, item_number, unit_price, quantity, total_price, source, product_id, item_type, sort_order, metadata)
      VALUES (v_quote, v_area, coalesce(r->'internal'->'isolator'->>'short_name', r->'isolator'->>'name'), r->'internal'->'isolator'->>'code',
        (r->'isolator'->>'ex')::numeric, 1, (r->'isolator'->>'ex')::numeric, 'catalog', (r->'internal'->'isolator'->>'product_id')::uuid, 'product', 3,
        jsonb_build_object('quote_category', 'labour', 'cost_excl', (r->'internal'->'isolator'->>'cost_ex')::numeric, 'unit_cost', (r->'internal'->'isolator'->>'cost_ex')::numeric, 'shop', true, 'isolator_allowance', true));
    END IF;
    v_desc := format('%s (%s room): %s, supplied and installed (standard back-to-back, up to 3.5 m of piping)%s',
      r->>'label', v_size_label, r->'unit'->>'name', CASE WHEN jsonb_typeof(r->'isolator') = 'object' THEN ', incl. isolator allowance' ELSE '' END);
    v_inv_lines := v_inv_lines || jsonb_build_object('description', v_desc, 'quantity', 1, 'rate', (r->>'room_ex')::numeric, 'amount', (r->>'room_ex')::numeric);
  END LOOP;

  SELECT total INTO v_qtotal FROM public.quotes WHERE id = v_quote;
  IF v_qtotal IS DISTINCT FROM o.total_incl THEN
    RAISE EXCEPTION 'shop: quote total % does not match paid order total %', v_qtotal, o.total_incl;
  END IF;

  -- Full-amount invoice (sent on insert, so no "invoice sent" email trigger; the shop sends its own confirmation).
  v_inv_no := public.generate_invoice_number();
  INSERT INTO public.invoices (quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total, issue_date, due_date, status, line_items, company_id, notes,
    sent_method, sent_channel, sent_note, payment_method)
  VALUES (v_quote, v_lead, v_owner, v_cust, v_name, v_phone, o.contact->>'email', o.contact->>'address',
    v_inv_no, o.subtotal_ex, 15, o.vat_amount, o.total_incl, current_date, current_date, 'sent', v_inv_lines, o.company_id,
    'ONLINE SHOP ORDER ' || o.order_ref || ': paid in full by card (Yoco).', 'manual', 'other', 'Online shop order, paid online', 'card')
  RETURNING id INTO v_inv;
  PERFORM set_config('app.invoice_unlock', 'on', true);
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount, line_name, line_type, room_label, sort_order, vat_rate)
  SELECT v_inv, x->>'description', 1, (x->>'rate')::numeric, (x->>'amount')::numeric, split_part(x->>'description', ':', 1), 'installation',
    split_part(split_part(x->>'description', ':', 1), ' (', 1), ord::int, 15
  FROM jsonb_array_elements(v_inv_lines) WITH ORDINALITY t(x, ord);
  PERFORM set_config('app.invoice_unlock', '', true);

  -- The Yoco payment (paid). The payments trigger marks the invoice paid (and notifies admins in-app).
  INSERT INTO public.payments (invoice_id, company_id, amount, payment_date, method, reference, gateway, gateway_reference, checkout_id,
    status, environment, currency, raw_payload)
  VALUES (v_inv, o.company_id, o.total_incl, current_date, 'card', o.order_ref, 'yoco', p_gateway_payment_id, coalesce(p_checkout_id, o.yoco_checkout_id),
    'paid', o.environment, 'ZAR', p_payload)
  RETURNING id INTO v_pay;

  -- Installation job, ready to schedule (no date: the requested time is only a request).
  INSERT INTO public.jobs (company_id, customer_id, lead_id, quote_id, invoice_id, title, description, address, lat, lng, status, job_type, priority, created_by)
  VALUES (o.company_id, v_cust, v_lead, v_quote, v_inv, 'Install: ' || jsonb_array_length(o.lines) || ' room(s), online order ' || o.order_ref,
    'Online shop order ' || o.order_ref || ', paid in full.' || v_rooms_txt ||
      CASE WHEN v_pref IS NOT NULL THEN E'\nRequested time (not booked yet): ' || v_pref ELSE '' END ||
      E'\nSite check on the day applies (terms 12).',
    o.contact->>'address', (o.contact->>'lat')::numeric, (o.contact->>'lng')::numeric, 'scheduled', 'installation', 'normal', v_owner)
  RETURNING id INTO v_job;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  VALUES (v_owner, 'shop_order_paid', 'Online order paid: ' || o.order_ref,
    v_name || ' paid R ' || to_char(o.total_incl, 'FM999 999 990.00') || ' in full for ' || jsonb_array_length(o.lines) || ' room(s). Book the installation.',
    v_job, jsonb_build_object('shop_order_id', o.id, 'job_id', v_job, 'invoice_id', v_inv, 'quote_id', v_quote, 'link', '/admin/invoices/' || v_inv));

  UPDATE public.shop_orders SET status = 'finalized', paid_at = coalesce(paid_at, now()), finalized_at = now(),
    yoco_checkout_id = coalesce(yoco_checkout_id, p_checkout_id), yoco_payment_id = p_gateway_payment_id, last_event = p_payload,
    customer_id = v_cust, lead_id = v_lead, quote_id = v_quote, invoice_id = v_inv, job_id = v_job, payment_id = v_pay, error = NULL
   WHERE id = o.id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'order_ref', o.order_ref, 'customer_id', v_cust, 'lead_id', v_lead,
    'quote_id', v_quote, 'quote_token', v_token, 'invoice_id', v_inv, 'invoice_number', v_inv_no, 'job_id', v_job, 'payment_id', v_pay,
    'total_incl', o.total_incl, 'email', o.contact->>'email', 'name', v_name, 'first_name', v_first, 'lines', (SELECT jsonb_agg(x - 'internal') FROM jsonb_array_elements(o.lines) x));
END $f$;

CREATE OR REPLACE FUNCTION public.fl_shop_mark_emailed(p_order uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  UPDATE public.shop_orders SET email_sent_at = now() WHERE id = p_order;
$f$;

REVOKE ALL ON FUNCTION public.fl_shop_order_create(uuid, jsonb, jsonb, jsonb, text, text, text, text), public.fl_shop_order_set_checkout(uuid, text),
  public.fl_shop_order_note_event(uuid, jsonb), public.fl_shop_finalize(uuid, text, text, bigint, text, jsonb), public.fl_shop_mark_emailed(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_shop_order_create(uuid, jsonb, jsonb, jsonb, text, text, text, text), public.fl_shop_order_set_checkout(uuid, text),
  public.fl_shop_order_note_event(uuid, jsonb), public.fl_shop_finalize(uuid, text, text, bigint, text, jsonb), public.fl_shop_mark_emailed(uuid)
  TO service_role;

-- get_public_quote also returns remote_quote_source (so the client page shows the shop's 12.5 "payment" wording). Additive key only.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.get_public_quote(uuid)'::regprocedure);
  IF position('remote_quote_source' in d) = 0 THEN
    d := replace(d, '''remote_quote'', v_quote.remote_quote /*rq1*/,', '''remote_quote'', v_quote.remote_quote /*rq1*/, ''remote_quote_source'', v_quote.remote_quote_source /*shop1*/,');
    IF position('remote_quote_source' in d) = 0 THEN RAISE EXCEPTION 'get_public_quote: anchor not found'; END IF;
    EXECUTE d;
  END IF;
END $do$;
