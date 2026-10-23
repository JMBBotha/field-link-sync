-- 0025 Accept -> draft invoice -> rep + admins alerted -> invoice auto-sends after N minutes unless someone holds it.
-- Johan 23 Oct 17:15 SAST: "admin and the salesperson (else admin) should immediately know the job was accepted and be
-- prompted to approve sending the invoice ... if they accept the job, the invoice should go out like 15 minutes later anyway,
-- and the deposits should be requested."
--   * create_deposit_invoice_for_quote (both client token accept and staff accept) still makes the DRAFT invoice, and now
--     queues an invoice_send_approvals row + a 'quote_accepted_send_invoice' alert ("<Client> accepted Q-xxxx").
--   * invoice_send_now(invoice)  : rep on the quote or an admin of that company sends it now.
--   * invoice_send_hold(invoice) : stops the auto-send until someone sends it by hand.
--   * process_due_invoice_sends(): pg_cron every minute, sends pending approvals whose due_at has passed.
--   * Sending = the existing draft->sent update, so the existing trg_invoices_sent_email email (with the
--     "deposit due" line) is the deposit request. One send only: row locks + "still draft" check.
--   * Any other path that sends/voids the invoice (SendInvoiceEmailButton, builder) closes the approval (sync trigger).
-- Idempotent: safe to run more than once. Rollback: drizzle/rollback/0025_accept_invoice_approval_rollback.sql

ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS invoice_auto_send_minutes integer NOT NULL DEFAULT 15;
DO $$ BEGIN
  ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_invoice_auto_send_minutes_chk
    CHECK (invoice_auto_send_minutes BETWEEN 0 AND 1440);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.company_settings.invoice_auto_send_minutes IS
  'Minutes after a quote is accepted before the deposit invoice auto-sends if nobody sends or holds it. 0 = never auto-send.';

CREATE TABLE IF NOT EXISTS public.invoice_send_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.invoices(id) ON DELETE CASCADE,
  quote_id uuid,
  company_id uuid,
  rep_id uuid,
  client_name text,
  quote_number text,
  invoice_number text,
  deposit_amount numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','sent','blocked','cancelled')),
  due_at timestamptz,
  decision text CHECK (decision IN ('send_now','hold','auto','manual','blocked','cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  hold_reason text,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_send_approvals_due_idx ON public.invoice_send_approvals (due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS invoice_send_approvals_company_idx ON public.invoice_send_approvals (company_id, status);

-- Append-only audit trail: who sent / held / let it auto-send, and when.
CREATE TABLE IF NOT EXISTS public.invoice_send_events (
  id bigserial PRIMARY KEY,
  approval_id uuid REFERENCES public.invoice_send_approvals(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_send_events_invoice_idx ON public.invoice_send_events (invoice_id, created_at);

-- POPIA: only the quote's rep and admins of that company can see an approval or its audit trail.
CREATE OR REPLACE FUNCTION public.isa_can_act(_uid uuid, _company_id uuid, _rep_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    _uid = _rep_id
    OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
                WHERE ur.user_id = _uid AND ur.role = 'admin' AND p.company_id IS NOT DISTINCT FROM _company_id)
  )
$$;
REVOKE ALL ON FUNCTION public.isa_can_act(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.isa_can_act(uuid, uuid, uuid) TO authenticated;

ALTER TABLE public.invoice_send_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_send_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isa_select ON public.invoice_send_approvals;
CREATE POLICY isa_select ON public.invoice_send_approvals FOR SELECT TO authenticated
  USING (public.isa_can_act(auth.uid(), company_id, rep_id));
DROP POLICY IF EXISTS ise_select ON public.invoice_send_events;
CREATE POLICY ise_select ON public.invoice_send_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoice_send_approvals a WHERE a.id = approval_id
                 AND public.isa_can_act(auth.uid(), a.company_id, a.rep_id)));
-- No insert/update/delete policies: all writes go through the SECURITY DEFINER functions below.
REVOKE ALL ON public.invoice_send_approvals, public.invoice_send_events FROM anon;
GRANT SELECT ON public.invoice_send_approvals, public.invoice_send_events TO authenticated;

-- Who to alert: the quote's rep plus that company's admins (admins alone if there is no rep).
CREATE OR REPLACE FUNCTION public.isa_recipients(_company_id uuid, _rep_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _rep_id WHERE _rep_id IS NOT NULL
  UNION
  SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'admin' AND p.company_id = _company_id
$$;
REVOKE ALL ON FUNCTION public.isa_recipients(uuid, uuid) FROM public, anon, authenticated;

-- Queue an approval for a freshly created deposit invoice and alert the rep + admins. Internal only.
CREATE OR REPLACE FUNCTION public.isa_queue(p_invoice_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.invoices%ROWTYPE; q public.quotes%ROWTYPE; v_min integer; v_due timestamptz; v_id uuid;
  v_client text; v_dep numeric; v_body text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = inv.quote_id;
  SELECT cs.invoice_auto_send_minutes INTO v_min FROM public.company_settings cs
   WHERE cs.company_id = inv.company_id ORDER BY cs.is_primary DESC, cs.updated_at DESC NULLS LAST, cs.id LIMIT 1;
  v_min := COALESCE(v_min, 15);
  v_due := CASE WHEN v_min > 0 THEN now() + make_interval(mins => v_min) END;
  v_client := COALESCE(NULLIF(btrim(inv.customer_name), ''), NULLIF(btrim(q.customer_name), ''), 'Client');
  v_dep := COALESCE(inv.deposit_amount,
                    CASE WHEN inv.deposit_type = 'percent' THEN ROUND(COALESCE(inv.grand_total,0) * COALESCE(inv.deposit_value,0) / 100.0, 2) END,
                    inv.grand_total);

  INSERT INTO public.invoice_send_approvals (invoice_id, quote_id, company_id, rep_id, client_name, quote_number,
    invoice_number, deposit_amount, status, due_at)
  VALUES (inv.id, inv.quote_id, inv.company_id, q.sales_engineer_id, v_client, q.quote_number,
    inv.invoice_number, v_dep, 'pending', v_due)
  ON CONFLICT (invoice_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN (SELECT id FROM public.invoice_send_approvals WHERE invoice_id = inv.id); END IF;

  INSERT INTO public.invoice_send_events (approval_id, invoice_id, actor_id, action, note)
  VALUES (v_id, inv.id, auth.uid(), 'queued',
          CASE WHEN v_due IS NULL THEN 'auto-send off' ELSE 'auto-send at ' || to_char(v_due AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || ' SAST' END);

  v_body := 'Invoice ' || COALESCE(inv.invoice_number, '') || ' (deposit R ' || to_char(v_dep, 'FM999999990.00') || ') is ready. '
    || CASE WHEN v_due IS NULL THEN 'Nothing has been sent yet. Send it when ready.'
            ELSE 'It sends to the client automatically at ' || to_char(v_due AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
                 || ' unless you send it now or hold it.' END;
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT u, 'quote_accepted_send_invoice', v_client || ' accepted ' || COALESCE(q.quote_number, 'the quote'), v_body, inv.id,
    jsonb_build_object('invoice_id', inv.id, 'quote_id', inv.quote_id, 'approval_id', v_id, 'due_at', v_due,
                       'link', '/admin/invoices/' || inv.id)
  FROM public.isa_recipients(inv.company_id, q.sales_engineer_id) u;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.isa_queue(uuid) FROM public, anon, authenticated;

-- The one place that sends. Same guards as the old auto-send. Returns 'sent' | 'already_sent' | 'blocked:<why>'.
CREATE OR REPLACE FUNCTION public._isa_send(p_invoice_id uuid, p_actor uuid, p_decision text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.invoice_send_approvals%ROWTYPE; inv public.invoices%ROWTYPE; v_email text; v_why text;
BEGIN
  SELECT * INTO a FROM public.invoice_send_approvals WHERE invoice_id = p_invoice_id FOR UPDATE;
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF inv.id IS NULL THEN RETURN 'blocked:invoice not found'; END IF;
  IF inv.status IS DISTINCT FROM 'draft' OR inv.sent_at IS NOT NULL THEN
    IF a.id IS NOT NULL AND a.status IN ('pending','held','blocked') THEN
      UPDATE public.invoice_send_approvals SET status = CASE WHEN inv.status IN ('void','cancelled') THEN 'cancelled' ELSE 'sent' END,
        sent_at = COALESCE(inv.sent_at, now()), updated_at = now() WHERE id = a.id;
    END IF;
    RETURN 'already_sent';
  END IF;
  IF a.id IS NOT NULL AND a.status = 'held' AND p_decision = 'auto' THEN RETURN 'held'; END IF;

  v_email := NULLIF(btrim(inv.customer_email), '');
  IF v_email IS NULL THEN SELECT NULLIF(btrim(c.email), '') INTO v_email FROM public.customers c WHERE c.id = inv.customer_id; END IF;
  IF v_email IS NULL THEN v_why := 'no client email';
  ELSIF COALESCE(inv.grand_total, 0) <= 0 THEN v_why := 'invoice total is R0';
  ELSIF inv.quote_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = inv.quote_id AND q.status = 'accepted') THEN
    v_why := 'quote is no longer accepted';
  ELSIF EXISTS (SELECT 1 FROM public.invoice_items it WHERE it.invoice_id = inv.id
                 AND COALESCE(it.quantity, 0) > 0 AND COALESCE(it.unit_price, 0) <= 0) THEN v_why := 'a line has no price';
  END IF;

  IF v_why IS NOT NULL THEN
    IF a.id IS NOT NULL THEN
      UPDATE public.invoice_send_approvals SET status = 'blocked', decision = 'blocked', last_error = v_why,
        decided_by = COALESCE(p_actor, decided_by), decided_at = now(), updated_at = now() WHERE id = a.id;
      INSERT INTO public.invoice_send_events (approval_id, invoice_id, actor_id, action, note)
      VALUES (a.id, inv.id, p_actor, 'blocked', v_why);
      IF p_decision = 'auto' AND a.status = 'pending' THEN
        INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
        SELECT u, 'invoice_send_blocked', 'Invoice ' || COALESCE(inv.invoice_number, '') || ' did not send',
          'Auto-send stopped: ' || v_why || '. Fix the invoice and send it by hand.', inv.id,
          jsonb_build_object('invoice_id', inv.id, 'quote_id', inv.quote_id, 'approval_id', a.id, 'link', '/admin/invoices/' || inv.id)
        FROM public.isa_recipients(a.company_id, a.rep_id) u;
      END IF;
    END IF;
    RETURN 'blocked:' || v_why;
  END IF;

  -- Close the approval first so the sync trigger below sees nothing open.
  IF a.id IS NOT NULL THEN
    UPDATE public.invoice_send_approvals SET status = 'sent', decision = p_decision, decided_by = p_actor,
      decided_at = now(), sent_at = now(), due_at = NULL, last_error = NULL, updated_at = now() WHERE id = a.id;
    INSERT INTO public.invoice_send_events (approval_id, invoice_id, actor_id, action, note)
    VALUES (a.id, inv.id, p_actor, CASE p_decision WHEN 'auto' THEN 'auto_sent' ELSE 'sent_now' END, v_email);
  END IF;
  PERFORM set_config('app.invoice_send_trigger', 'accept_approval_' || p_decision, true);
  UPDATE public.invoices SET status = 'sent', sent_at = now(), sent_method = 'email', sent_by = p_actor, updated_at = now()
   WHERE id = inv.id AND status = 'draft' AND sent_at IS NULL;   -- fires trg_invoices_sent_email (client + accounts copy)
  PERFORM set_config('app.invoice_send_trigger', '', true);
  RETURN 'sent';
END $$;
REVOKE ALL ON FUNCTION public._isa_send(uuid, uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.isa_assert_can_act(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid; v_rep uuid;
BEGIN
  SELECT i.company_id, COALESCE(a.rep_id, q.sales_engineer_id) INTO v_company, v_rep
    FROM public.invoices i
    LEFT JOIN public.invoice_send_approvals a ON a.invoice_id = i.id
    LEFT JOIN public.quotes q ON q.id = i.quote_id
   WHERE i.id = p_invoice_id;
  IF NOT FOUND OR NOT public.isa_can_act(auth.uid(), v_company, v_rep) THEN
    RAISE EXCEPTION 'Not allowed to send this invoice' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.isa_assert_can_act(uuid) FROM public, anon, authenticated;

-- "Send invoice now" (alert, attention panel, AcceptGuideDialog). Safe to tap twice.
CREATE OR REPLACE FUNCTION public.invoice_send_now(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res text;
BEGIN
  PERFORM public.isa_assert_can_act(p_invoice_id);
  v_res := public._isa_send(p_invoice_id, auth.uid(), 'send_now');
  RETURN jsonb_build_object('result', v_res);
END $$;
REVOKE ALL ON FUNCTION public.invoice_send_now(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.invoice_send_now(uuid) TO authenticated;

-- "Hold": no auto-send until someone sends it by hand. Reason optional.
CREATE OR REPLACE FUNCTION public.invoice_send_hold(p_invoice_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.invoice_send_approvals%ROWTYPE;
BEGIN
  PERFORM public.isa_assert_can_act(p_invoice_id);
  SELECT * INTO a FROM public.invoice_send_approvals WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF a.id IS NULL THEN RETURN jsonb_build_object('result', 'no_approval'); END IF;
  IF a.status IN ('sent','cancelled') THEN RETURN jsonb_build_object('result', 'already_sent'); END IF;
  IF a.status = 'held' THEN RETURN jsonb_build_object('result', 'already_held'); END IF;
  UPDATE public.invoice_send_approvals SET status = 'held', decision = 'hold', decided_by = auth.uid(), decided_at = now(),
    hold_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''), due_at = NULL, updated_at = now() WHERE id = a.id;
  INSERT INTO public.invoice_send_events (approval_id, invoice_id, actor_id, action, note)
  VALUES (a.id, p_invoice_id, auth.uid(), 'held', NULLIF(btrim(COALESCE(p_reason, '')), ''));
  RETURN jsonb_build_object('result', 'held');
END $$;
REVOKE ALL ON FUNCTION public.invoice_send_hold(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.invoice_send_hold(uuid, text) TO authenticated;

-- Cron worker: sends whatever is due. SKIP LOCKED so two runs never send the same invoice.
CREATE OR REPLACE FUNCTION public.process_due_invoice_sends()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_res text; v_n integer := 0;
BEGIN
  FOR r IN SELECT id, invoice_id FROM public.invoice_send_approvals
            WHERE status = 'pending' AND due_at IS NOT NULL AND due_at <= now()
            ORDER BY due_at LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      v_res := public._isa_send(r.invoice_id, NULL, 'auto');
      IF v_res = 'sent' THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.invoice_send_approvals SET attempts = attempts + 1, last_error = left(SQLERRM, 300),
        status = CASE WHEN attempts + 1 >= 3 THEN 'blocked' ELSE status END,
        due_at = CASE WHEN attempts + 1 >= 3 THEN NULL ELSE now() + interval '2 minutes' END, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.invoice_send_events (approval_id, invoice_id, action, note) VALUES (r.id, r.invoice_id, 'error', left(SQLERRM, 300));
    END;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.process_due_invoice_sends() FROM public, anon, authenticated;

-- Any other send / void of the invoice (SendInvoiceEmailButton, builder, mark-as-sent) closes the approval.
CREATE OR REPLACE FUNCTION public.isa_sync_on_invoice_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_void boolean := NEW.status IN ('void','cancelled');
BEGIN
  IF OLD.status IS DISTINCT FROM 'draft' OR NEW.status = 'draft' THEN RETURN NULL; END IF;
  UPDATE public.invoice_send_approvals
     SET status = CASE WHEN v_void THEN 'cancelled' ELSE 'sent' END,
         decision = CASE WHEN v_void THEN 'cancelled' ELSE 'manual' END,
         decided_by = auth.uid(), decided_at = now(), sent_at = CASE WHEN v_void THEN NULL ELSE COALESCE(NEW.sent_at, now()) END,
         due_at = NULL, updated_at = now()
   WHERE invoice_id = NEW.id AND status IN ('pending','held','blocked')
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.invoice_send_events (approval_id, invoice_id, actor_id, action, note)
    VALUES (v_id, NEW.id, auth.uid(), CASE WHEN v_void THEN 'cancelled' ELSE 'sent_manually' END, NEW.status);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.isa_sync_on_invoice_status() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_isa_sync_on_invoice_status ON public.invoices;
CREATE TRIGGER trg_isa_sync_on_invoice_status AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.isa_sync_on_invoice_status();

-- Accept path: identical to the live function except the old 'invoice_ready_to_send' notice is replaced by isa_queue().
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

  -- 0025: alert rep + company admins ("<Client> accepted Q-xxxx") and queue the timed send (default 15 min).
  PERFORM public.isa_queue(v_id);
  RETURN v_id;
END $function$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_send_approvals;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('invoice-send-approvals') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoice-send-approvals');
    PERFORM cron.schedule('invoice-send-approvals', '* * * * *', 'SELECT public.process_due_invoice_sends()');
  END IF;
END $$;
