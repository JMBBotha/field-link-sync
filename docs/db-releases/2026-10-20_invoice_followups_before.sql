-- Live definitions captured 20 Oct 2026 before invoice follow-ups apply.
CREATE OR REPLACE FUNCTION public.pf_claim_send(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.pf_decide(p_id uuid, p_approve boolean, p_message text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.pf_flag_overdue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

