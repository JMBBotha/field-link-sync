-- Grok work assistant phase 4: payment follow-up approvals (Johan 2026-10-13 13:41). ADDITIVE ONLY.
-- Rollback: docs/db-releases/2026-10-13_gwa_p4_rollback.sql
-- Rule: no money message to a client without an owner-approved, per-client, single-use record.
CREATE TABLE IF NOT EXISTS public.payment_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  invoice_number text,
  amount_due numeric(12,2) NOT NULL DEFAULT 0,
  due_date date,
  days_late int,
  stage int NOT NULL DEFAULT 0 CHECK (stage IN (0,3,7)),   -- 3/7 = auto flag, 0 = asked by staff
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','sent','cancelled')),
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','email')),
  proposed_message text NOT NULL,
  approved_message text,
  requested_by uuid,
  decided_by uuid, decided_at timestamptz, decision_note text,
  sent_by uuid, sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_followups_auto_stage_uq ON public.payment_followups (invoice_id, stage) WHERE stage IN (3,7);
CREATE INDEX IF NOT EXISTS payment_followups_company_idx ON public.payment_followups (company_id, status);
ALTER TABLE public.payment_followups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._pf_office(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND p_company IS NOT NULL
    AND p_company = public.get_user_company_id(auth.uid())
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'dispatcher'::app_role))
    AND NOT public.is_sales_rep(auth.uid()) AND NOT public.is_field_tech_only(auth.uid())
$$;
CREATE OR REPLACE FUNCTION public._pf_owner(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND p_company = public.get_user_company_id(auth.uid())
    AND public.is_company_owner(auth.uid(), p_company)
$$;
DROP POLICY IF EXISTS pf_select ON public.payment_followups;
CREATE POLICY pf_select ON public.payment_followups FOR SELECT TO authenticated USING (public._pf_office(company_id));
GRANT SELECT ON public.payment_followups TO authenticated;
-- No INSERT/UPDATE/DELETE policies: all changes go through the RPCs below.

CREATE OR REPLACE FUNCTION public._pf_amount_due(p_invoice uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT GREATEST(0, COALESCE(i.grand_total,0) - COALESCE((SELECT sum(p.amount) FROM public.payments p
    WHERE p.invoice_id = i.id AND COALESCE(p.status,'paid') IN ('paid','succeeded','completed')),0))
  FROM public.invoices i WHERE i.id = p_invoice
$$;
-- "Sent" = emailed, WhatsApped or marked sent by hand (sent_method='manual').
CREATE OR REPLACE FUNCTION public._pf_invoice_sent(p_sent_at timestamptz, p_sent_method text, p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_sent_at IS NOT NULL OR p_sent_method IS NOT NULL OR lower(COALESCE(p_status,'')) IN ('sent','overdue','partially_paid','part_paid','viewed')
$$;
CREATE OR REPLACE FUNCTION public._pf_default_message(p_name text, p_no text, p_amount numeric, p_due date, p_company text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('Hi %s, just a friendly reminder that invoice %s for R%s was due on %s. If you have already paid, thank you, and please ignore this message. If anything is unclear, just let us know and we will gladly help. Kind regards, %s',
    COALESCE(NULLIF(btrim(p_name),''),'there'), COALESCE(p_no,''), to_char(p_amount,'FM999G999G990D00'), to_char(p_due,'DD Mon YYYY'), COALESCE(p_company,'the team'))
$$;
-- Soft tone only: no legal / penalty / blacklist language in any approved message.
CREATE OR REPLACE FUNCTION public._pf_tone_ok(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_text !~* '(legal|lawyer|attorney|court|summons|sue\M|blacklist|penalt|hand(ed)? ?over|debt collect|collections agency|\mITC\M|credit bureau|final demand|letter of demand|or else|consequences)'
$$;

CREATE OR REPLACE FUNCTION public._pf_notify_owners(p_company uuid, p_title text, p_body text, p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT m.user_id, 'payment_followup', p_title, p_body, p_id, jsonb_build_object('route','/admin/payment-followups')
  FROM public.company_members m WHERE m.company_id = p_company AND m.is_owner
$$;

-- Daily: flag sent, unpaid invoices at 3 and 7 days past DUE date to that company's owner. Never contacts clients.
CREATE OR REPLACE FUNCTION public.pf_flag_overdue() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v_stage int; v_due numeric; v_id uuid; n int := 0;
BEGIN
  FOR r IN SELECT i.*, c.name AS company_name FROM public.invoices i JOIN public.companies c ON c.id = i.company_id
           WHERE i.due_date IS NOT NULL AND i.due_date <= v_today - 3
             AND lower(COALESCE(i.status,'')) NOT IN ('paid','draft','cancelled','void','archived')
  LOOP
    IF NOT public._pf_invoice_sent(r.sent_at, r.sent_method, r.status) THEN CONTINUE; END IF;
    v_due := public._pf_amount_due(r.id);
    IF v_due <= 0 THEN CONTINUE; END IF;
    v_stage := CASE WHEN r.due_date <= v_today - 7 THEN 7 ELSE 3 END;
    IF EXISTS (SELECT 1 FROM public.payment_followups f WHERE f.invoice_id = r.id AND f.stage = v_stage) THEN CONTINUE; END IF;
    -- A newer flag replaces an undecided older one (owner sees one item per client invoice).
    UPDATE public.payment_followups SET status = 'cancelled', decision_note = 'superseded by a later flag'
      WHERE invoice_id = r.id AND status = 'pending';
    INSERT INTO public.payment_followups (company_id, invoice_id, customer_id, customer_name, customer_phone, invoice_number,
        amount_due, due_date, days_late, stage, proposed_message)
      VALUES (r.company_id, r.id, r.customer_id, r.customer_name, r.customer_phone, r.invoice_number, v_due, r.due_date,
        v_today - r.due_date, v_stage, public._pf_default_message(r.customer_name, r.invoice_number, v_due, r.due_date, r.company_name))
      RETURNING id INTO v_id;
    PERFORM public._pf_notify_owners(r.company_id, format('%s is %s days late', COALESCE(r.customer_name,'A client'), v_today - r.due_date),
      format('Invoice %s, R%s outstanding. Approve or decline a friendly reminder.', r.invoice_number, to_char(v_due,'FM999G999G990D00')), v_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pf_flag_overdue() FROM PUBLIC, anon, authenticated;

-- Staff ask for a follow-up (office/admin of the company). Creates a PENDING request for the owner.
CREATE OR REPLACE FUNCTION public.pf_request(p_invoice uuid, p_message text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i public.invoices; v_due numeric; v_id uuid; v_co text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND OR NOT public._pf_office(i.company_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT public._pf_invoice_sent(i.sent_at, i.sent_method, i.status) THEN RAISE EXCEPTION 'This invoice has not been sent yet.'; END IF;
  v_due := public._pf_amount_due(i.id);
  IF v_due <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on this invoice.'; END IF;
  SELECT id INTO v_id FROM public.payment_followups WHERE invoice_id = i.id AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF p_message IS NOT NULL AND NOT public._pf_tone_ok(p_message) THEN RAISE EXCEPTION 'Please keep the message friendly: no legal, penalty or blacklist wording.'; END IF;
  SELECT name INTO v_co FROM public.companies WHERE id = i.company_id;
  INSERT INTO public.payment_followups (company_id, invoice_id, customer_id, customer_name, customer_phone, invoice_number, amount_due,
      due_date, days_late, stage, proposed_message, requested_by)
    VALUES (i.company_id, i.id, i.customer_id, i.customer_name, i.customer_phone, i.invoice_number, v_due, i.due_date,
      CASE WHEN i.due_date IS NULL THEN NULL ELSE (now() AT TIME ZONE 'Africa/Johannesburg')::date - i.due_date END, 0,
      COALESCE(NULLIF(btrim(p_message),''), public._pf_default_message(i.customer_name, i.invoice_number, v_due, i.due_date, v_co)), auth.uid())
    RETURNING id INTO v_id;
  PERFORM public._pf_notify_owners(i.company_id, format('Follow-up requested: %s', COALESCE(i.customer_name,'client')),
    format('Invoice %s, R%s outstanding. Approve or decline.', i.invoice_number, to_char(v_due,'FM999G999G990D00')), v_id);
  RETURN v_id;
END $$;

-- The company's OWNER decides, per client. (Massair: Johan for Massair clients only.)
CREATE OR REPLACE FUNCTION public.pf_decide(p_id uuid, p_approve boolean, p_message text DEFAULT NULL, p_note text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f public.payment_followups; v_msg text;
BEGIN
  SELECT * INTO f FROM public.payment_followups WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._pf_owner(f.company_id) THEN RAISE EXCEPTION 'Only the company owner can approve follow-ups' USING ERRCODE = '42501'; END IF;
  IF f.status <> 'pending' THEN RAISE EXCEPTION 'Already %', f.status; END IF;
  v_msg := COALESCE(NULLIF(btrim(p_message),''), f.proposed_message);
  IF p_approve AND NOT public._pf_tone_ok(v_msg) THEN RAISE EXCEPTION 'Please keep the message friendly: no legal, penalty or blacklist wording.'; END IF;
  UPDATE public.payment_followups SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
    approved_message = CASE WHEN p_approve THEN v_msg END, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
    WHERE id = p_id;
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'declined' END;
END $$;

-- Single use: claims an APPROVED follow-up for sending and returns the exact approved text. Re-checks it's still unpaid.
CREATE OR REPLACE FUNCTION public.pf_claim_send(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f public.payment_followups;
BEGIN
  SELECT * INTO f FROM public.payment_followups WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public._pf_office(f.company_id) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF f.status <> 'approved' THEN RAISE EXCEPTION 'This follow-up is % — it needs the owner''s approval first.', f.status; END IF;
  IF public._pf_amount_due(f.invoice_id) <= 0 THEN
    UPDATE public.payment_followups SET status = 'cancelled', decision_note = 'invoice paid before sending' WHERE id = p_id;
    RAISE EXCEPTION 'The invoice has been paid since, so nothing was sent.';
  END IF;
  UPDATE public.payment_followups SET status = 'sent', sent_at = now(), sent_by = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('id', f.id, 'message', f.approved_message, 'phone', f.customer_phone, 'customer_name', f.customer_name,
    'invoice_number', f.invoice_number, 'channel', f.channel);
END $$;
GRANT EXECUTE ON FUNCTION public.pf_request(uuid, text), public.pf_decide(uuid, boolean, text, text), public.pf_claim_send(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pf_request(uuid, text), public.pf_decide(uuid, boolean, text, text), public.pf_claim_send(uuid) FROM anon;

-- DB gate on the client-message queues: a money message must carry a just-claimed approval for the same invoice.
CREATE OR REPLACE FUNCTION public._pf_money_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_kind text; v_fid uuid; v_inv uuid;
BEGIN
  IF TG_TABLE_NAME = 'notification_queue' THEN
    v_kind := COALESCE(NEW.notification_type,''); v_inv := NEW.invoice_id;
    BEGIN v_fid := NULLIF(NEW.variables->>'followup_id','')::uuid; EXCEPTION WHEN others THEN v_fid := NULL; END;
  ELSE
    v_kind := COALESCE(NEW.event_type,''); v_inv := NULL;
    BEGIN v_fid := NULLIF(NEW.payload->>'followup_id','')::uuid; v_inv := NULLIF(NEW.payload->>'invoice_id','')::uuid; EXCEPTION WHEN others THEN v_fid := NULL; END;
  END IF;
  IF v_kind !~* '(payment_reminder|payment_followup|payment_follow_up|overdue|arrears|debt|statement_reminder|invoice_reminder|dunning|chase)' THEN RETURN NEW; END IF;
  IF v_fid IS NULL OR NOT EXISTS (SELECT 1 FROM public.payment_followups f WHERE f.id = v_fid AND f.status = 'sent'
        AND f.sent_at > now() - interval '15 minutes' AND (v_inv IS NULL OR f.invoice_id = v_inv)) THEN
    RAISE EXCEPTION 'Payment follow-ups need the owner''s approval for this client first (no approved record).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pf_money_gate ON public.notification_queue;
CREATE TRIGGER trg_pf_money_gate BEFORE INSERT ON public.notification_queue FOR EACH ROW EXECUTE FUNCTION public._pf_money_gate();
DROP TRIGGER IF EXISTS trg_pf_money_gate ON public.entity_outbox;
CREATE TRIGGER trg_pf_money_gate BEFORE INSERT ON public.entity_outbox FOR EACH ROW EXECUTE FUNCTION public._pf_money_gate();

SELECT cron.unschedule('payment-followup-flags') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-followup-flags');
SELECT cron.schedule('payment-followup-flags', '30 4 * * *', 'SELECT public.pf_flag_overdue()');  -- 06:30 SAST daily
