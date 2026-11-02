-- live propose_change + real trigger wiring (2026-11-02)
CREATE OR REPLACE FUNCTION public.propose_change(p_action_type text, p_summary text, p_payload jsonb DEFAULT '{}'::jsonb, p_target_table text DEFAULT NULL::text, p_target_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_checked_note text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE co uuid := public._walda_co(); v_id uuid;
BEGIN
  IF public.bot_action_kind(p_action_type) IS NULL THEN RAISE EXCEPTION 'unknown action type % (use other)', p_action_type; END IF;
  IF nullif(trim(coalesce(p_summary,'')),'') IS NULL THEN RAISE EXCEPTION 'summary needed'; END IF;
  INSERT INTO bot_proposed_changes(company_id, proposer_id, action_type, target_table, target_id, payload, summary, reason, checked_note)
  VALUES (co, auth.uid(), p_action_type, p_target_table, p_target_id, coalesce(p_payload,'{}'::jsonb), left(p_summary,500), left(p_reason,2000), left(p_checked_note,500))
  RETURNING id INTO v_id;
  INSERT INTO notifications(user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT cm.user_id, 'bot_proposal', 'WALDA needs your OK', left(p_summary,200), v_id, jsonb_build_object('proposal_id', v_id, 'action_type', p_action_type)
  FROM company_members cm WHERE cm.company_id=co AND cm.role='admin' AND NOT public.is_sales_rep(cm.user_id);
  PERFORM public._bot_audit(co, 'propose_'||p_action_type, 'bot_proposed_changes', v_id, NULL, jsonb_build_object('summary',p_summary,'payload',p_payload));
  RETURN v_id;
END $function$;
CREATE TRIGGER trg_invoices_sent_email AFTER UPDATE ON public.invoices FOR EACH ROW WHEN (((new.status = 'sent'::text) AND ((old.status IS NULL) OR (old.status = 'draft'::text)))) EXECUTE FUNCTION notify_document_sent();
CREATE TRIGGER trg_test_outbox AFTER UPDATE ON public.invoices FOR EACH ROW WHEN (new.status='sent' AND old.status='draft') EXECUTE FUNCTION _test_outbox();
