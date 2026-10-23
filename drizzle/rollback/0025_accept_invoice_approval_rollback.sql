-- Rollback for 0025_accept_invoice_approval. Restores the 0024 state: draft invoice + 'invoice_ready_to_send'
-- notice on accept, no timed auto-send. Approval/audit rows are dropped (export them first if wanted:
--   COPY (SELECT * FROM public.invoice_send_events) TO STDOUT ...).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('invoice-send-approvals') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoice-send-approvals');
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_isa_sync_on_invoice_status ON public.invoices;
CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes%ROWTYPE; cust record; v_existing uuid; v_pct numeric; v_number text;
  v_subtotal numeric; v_vat numeric; v_total numeric; v_rate numeric; v_agent uuid; v_id uuid; v_dep numeric;
BEGIN
  IF COALESCE(current_setting('app.public_quote_accept', true), '') IS DISTINCT FROM p_quote_id::text THEN PERFORM public.rh_assert(false); END IF; /*rh1*/
  PERFORM pg_advisory_xact_lock(hashtextextended('deposit_invoice:' || p_quote_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('balance_invoice:' || p_quote_id::text, 0));
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(current_setting('app.public_quote_accept', true), '') IS DISTINCT FROM p_quote_id::text AND COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not authorized for this quote' USING ERRCODE = '42501'; END IF; /*xco*/
  -- oneinv: any live invoice on this quote = done (idempotent)
  SELECT id INTO v_existing FROM public.invoices WHERE quote_id = q.id AND COALESCE(status,'') NOT IN ('void','cancelled') ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(default_deposit_percentage, 70) INTO v_pct FROM public.company_settings
   WHERE company_id = COALESCE(q.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1))
   ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*inv1*/ /*p4cs*/
  v_pct := COALESCE(v_pct, 70); IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 70; END IF;
  IF public.payment_plan_ok(q.payment_plan) AND q.payment_plan IS NOT NULL THEN v_pct := (q.payment_plan->'stages'->0->>'pct')::numeric; END IF; /*acct1*/

  v_total := ROUND(COALESCE(q.total, 0), 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0), 2);
  v_subtotal := v_total - v_vat;
  v_dep := ROUND(v_total * v_pct / 100.0, 2);
  v_rate := COALESCE(q.vat_rate, 0.15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN RETURN NULL; END IF;
  v_number := public.generate_invoice_number();

  INSERT INTO public.invoices (quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes, deposit_type, deposit_value)
  VALUES (q.id, q.lead_id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_subtotal, v_rate, v_vat, v_total, CURRENT_DATE + 30, 'draft',
    jsonb_build_array(jsonb_build_object('description', 'Quote ' || COALESCE(q.quote_number, '') || ' as accepted', 'quantity', 1, 'rate', v_subtotal, 'amount', v_subtotal)),
    q.company_id,
    'Quote ' || COALESCE(q.quote_number, '') || ': total R ' || to_char(v_total,'FM999999990.00') || ' incl VAT. ' || ROUND(v_pct)::text
      || '% deposit R ' || to_char(v_dep,'FM999999990.00') || ' due now; balance R ' || to_char(v_total - v_dep,'FM999999990.00') || ' on completion.',
    'percent', v_pct)
  RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id, 'Quote ' || COALESCE(q.quote_number, '') || ' as accepted', 1, v_subtotal, v_subtotal);

  -- oneinv: never auto-send. Rep (else company admins) reviews the email + PDF and sends.
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT u, 'invoice_ready_to_send', 'Invoice ' || v_number || ' ready to send',
    'Quote ' || COALESCE(q.quote_number, '') || ' was accepted. Check invoice ' || v_number || ' (deposit R ' || to_char(v_dep,'FM999999990.00') || ') and send it to the client. Nothing has been sent yet.',
    v_id, jsonb_build_object('invoice_id', v_id, 'quote_id', q.id, 'link', '/admin/invoices/' || v_id)
  FROM (SELECT q.sales_engineer_id AS u WHERE q.sales_engineer_id IS NOT NULL
        UNION SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
         WHERE ur.role = 'admin' AND p.company_id = q.company_id) t;
  RETURN v_id;
END $function$
;
-- Restore live accept_quote_by_token (two alerts on online accept, as before 0025).
CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_quote_id uuid; v_num text; v_cust text; v_status text;
BEGIN
  SELECT id, quote_number, customer_name, status INTO v_quote_id, v_num, v_cust, v_status
  FROM public.quotes WHERE public_token = p_token FOR UPDATE;
  IF v_quote_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote_id AND is_variation) THEN RETURN false; END IF; /*r2: use respond_job_variation*/
  IF v_status = 'accepted' THEN RETURN true; END IF; /*oneinv: retry / queued double-submit is not an error*/
  IF v_status NOT IN ('sent','viewed') THEN RETURN false; END IF;
  -- Set BEFORE the update so the on_quote_accepted trigger path is also allowed for the token holder.
  PERFORM set_config('app.public_quote_accept', v_quote_id::text, true);
  UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = p_accepted_by, accepted_signature = p_signature
  WHERE id = v_quote_id;
  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);
  PERFORM set_config('app.public_quote_accept', '', true);
  PERFORM public.qa_notify_rep_and_admins(v_quote_id, 'quote_accepted_client',
    'Quote ' || COALESCE(v_num, '') || ' accepted by client',
    COALESCE(NULLIF(p_accepted_by, ''), v_cust, 'Client') || ' accepted quote ' || COALESCE(v_num, '') || ' online.');
  RETURN true;
END $function$;
DROP FUNCTION IF EXISTS public.process_due_invoice_sends();
DROP FUNCTION IF EXISTS public.invoice_send_now(uuid);
DROP FUNCTION IF EXISTS public.invoice_send_hold(uuid, text);
DROP FUNCTION IF EXISTS public.isa_assert_can_act(uuid);
DROP FUNCTION IF EXISTS public._isa_send(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.isa_queue(uuid);
DROP FUNCTION IF EXISTS public.isa_sync_on_invoice_status();
DROP TABLE IF EXISTS public.invoice_send_events;
DROP TABLE IF EXISTS public.invoice_send_approvals;
DROP FUNCTION IF EXISTS public.isa_recipients(uuid, uuid);
DROP FUNCTION IF EXISTS public.isa_can_act(uuid, uuid, uuid);
ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_invoice_auto_send_minutes_chk;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS invoice_auto_send_minutes;
-- and: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <0025 journal when>;
