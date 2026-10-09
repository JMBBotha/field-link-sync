-- Accounting step 1 (2026-10-09): payment plans per quote (e.g. 70/30, 65/35, 20/60/20).
-- quotes.payment_plan NULL = today's behaviour (company deposit %, balance on completion).
-- Stage invoices are created as DRAFT and never sent automatically.
CREATE TABLE IF NOT EXISTS public._acct_backups (id bigserial PRIMARY KEY, step text NOT NULL, object text NOT NULL, definition text, saved_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public._acct_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._acct_backups FROM anon, authenticated;

DO $b$ BEGIN
  IF md5(pg_get_functiondef('public.create_deposit_invoice_for_quote(uuid)'::regprocedure)) <> 'a60748f244c5337dd1adb9f32136b0c1'
  OR md5(pg_get_functiondef('public._create_balance_invoice(uuid)'::regprocedure)) <> '95c602d695aae0b7e365a6541cf269a8' THEN
    RAISE EXCEPTION 'deposit/balance functions changed since review - stop'; END IF;
  INSERT INTO public._acct_backups(step, object, definition)
  SELECT 'acct1', p.oid::regprocedure::text, pg_get_functiondef(p.oid) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('create_deposit_invoice_for_quote', '_create_balance_invoice', 'get_public_quote');
END $b$;

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS payment_plan jsonb;
COMMENT ON COLUMN public.quotes.payment_plan IS 'Accounting step 1: {"name":"20/60/20","stages":[{"pct":20,"label":"Deposit"},...]}; NULL = company deposit % + balance';

CREATE OR REPLACE FUNCTION public.payment_plan_ok(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT p IS NULL OR (
    jsonb_typeof(p->'stages') = 'array' AND jsonb_array_length(p->'stages') BETWEEN 2 AND 4
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'stages') s
                     WHERE jsonb_typeof(s->'pct') <> 'number' OR (s->>'pct')::numeric <= 0 OR (s->>'pct')::numeric >= 100)
    AND (SELECT sum((s->>'pct')::numeric) FROM jsonb_array_elements(p->'stages') s) = 100)
$f$;
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_payment_plan_ok;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_payment_plan_ok CHECK (public.payment_plan_ok(payment_plan));

-- Deposit = stage 1 of the plan when a plan is set.
DO $p$ DECLARE d text := pg_get_functiondef('public.create_deposit_invoice_for_quote(uuid)'::regprocedure);
  a text := E'  IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 70; END IF;\n';
BEGIN
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'deposit anchor not found'; END IF;
  EXECUTE replace(d, a, a || E'  IF public.payment_plan_ok(q.payment_plan) AND q.payment_plan IS NOT NULL THEN v_pct := (q.payment_plan->''stages''->0->>''pct'')::numeric; END IF; /*acct1*/\n');
END $p$;

-- Balance: a progress-stage invoice is not the balance invoice (final = total less everything already invoiced).
DO $p$ DECLARE d text := pg_get_functiondef('public._create_balance_invoice(uuid)'::regprocedure);
  a text := $a$AND COALESCE(notes,'') NOT LIKE 'DEPOSIT%'$a$;
BEGIN
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'balance anchor not found'; END IF;
  EXECUTE replace(d, a, a || $r$ AND COALESCE(notes,'') NOT LIKE 'STAGE%' /*acct1*/$r$);
END $p$;

-- Public quote shows the plan (terms text on the client page).
DO $p$ DECLARE d text := pg_get_functiondef('public.get_public_quote(uuid)'::regprocedure);
  a text := $a$'discount_value', v_quote.discount_value$a$;
BEGIN
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'public quote anchor not found'; END IF;
  EXECUTE replace(d, a, a || $r$, 'payment_plan', v_quote.payment_plan /*acct1*/$r$);
END $p$;

-- Middle stage invoices (e.g. the 60% of 20/60/20). Final stage stays the existing balance invoice.
CREATE OR REPLACE FUNCTION public.create_stage_invoice_for_quote(p_quote_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE q public.quotes%ROWTYPE; cust record; n int; k int; v_done int; v_pct numeric; v_label text; v_frac numeric;
  v_sub numeric; v_vat numeric; v_tot numeric; v_rate numeric; v_agent uuid; v_number text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.is_field_tech_only(auth.uid()) OR NOT public.is_ops_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('deposit_invoice:' || p_quote_id::text, 0));
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF q.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Not authorized for this quote' USING ERRCODE = '42501'; END IF;
  IF public.is_sales_rep(auth.uid()) AND q.sales_engineer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Not your quote' USING ERRCODE = '42501'; END IF;
  n := COALESCE(jsonb_array_length(q.payment_plan->'stages'), 0);
  IF n < 3 THEN RAISE EXCEPTION 'This quote has no progress stage (plan has % stages)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE quote_id = q.id AND COALESCE(notes,'') LIKE 'DEPOSIT%' AND COALESCE(status,'') NOT IN ('void','cancelled')) THEN
    RAISE EXCEPTION 'Create the deposit invoice first'; END IF;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE quote_id = q.id AND COALESCE(notes,'') LIKE 'BALANCE%' AND COALESCE(status,'') NOT IN ('void','cancelled')) THEN
    RAISE EXCEPTION 'The balance is already invoiced'; END IF;
  SELECT count(*) INTO v_done FROM public.invoices WHERE quote_id = q.id AND COALESCE(notes,'') LIKE 'STAGE%' AND COALESCE(status,'') NOT IN ('void','cancelled');
  k := v_done + 2;                       -- 1-based stage number to invoice now
  IF k >= n THEN RAISE EXCEPTION 'Only the final balance is left (invoiced on completion)'; END IF;
  v_pct := (q.payment_plan->'stages'->(k - 1)->>'pct')::numeric;
  v_label := COALESCE(NULLIF(q.payment_plan->'stages'->(k - 1)->>'label', ''), 'Progress payment');
  v_frac := v_pct / 100.0;
  v_sub := ROUND(COALESCE(q.subtotal, 0) * v_frac, 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0) * v_frac, 2);
  v_tot := ROUND(COALESCE(q.total, 0) * v_frac, 2);
  v_rate := COALESCE(q.vat_rate, 0.15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  v_number := public.generate_invoice_number();
  INSERT INTO public.invoices (quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes)
  VALUES (q.id, q.lead_id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_sub, v_rate, v_vat, v_tot, CURRENT_DATE + 7, 'draft',
    jsonb_build_array(jsonb_build_object('description', v_label || ' (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
      'quantity', 1, 'rate', v_sub, 'amount', v_sub)),
    q.company_id,
    'STAGE ' || k || '/' || n || ' — ' || ROUND(v_pct)::text || '% of quote ' || COALESCE(q.quote_number, '') || ' (' || v_label || ').')
  RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id, v_label || ' (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''), 1, v_sub, v_sub);
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.create_stage_invoice_for_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stage_invoice_for_quote(uuid) TO authenticated;
