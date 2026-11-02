-- Undo 20261102200000_walda_invoice_mark_sent: restore the pre-change functions (live 2026-11-02).
-- Invoices already marked sent stay sent (they were really sent in FreshBooks); to find them:
--   SELECT id, invoice_number FROM invoices WHERE sent_method='external' AND sent_note='sent from FreshBooks';
-- Pending invoice_mark_sent proposals become unknown types; reject them first:
--   UPDATE bot_proposed_changes SET status='rejected', review_note='type removed' WHERE action_type='invoice_mark_sent' AND status='pending';
BEGIN;
CREATE OR REPLACE FUNCTION public.bot_action_kind(p_type text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_type
    WHEN 'invoice_send' THEN 'executable'
    WHEN 'invoice_void' THEN 'executable'
    WHEN 'bank_unmatch' THEN 'executable'
    WHEN 'bank_ignore' THEN 'executable'
    WHEN 'bank_new_expense' THEN 'executable'
    WHEN 'customer_set_rep' THEN 'executable'
    WHEN 'payment_cancel' THEN 'executable'
    WHEN 'catalogue_price_change' THEN 'manual'
    WHEN 'stock_adjust' THEN 'manual'
    WHEN 'user_role_change' THEN 'manual'
    WHEN 'email_supplier' THEN 'manual'
    WHEN 'email_client' THEN 'manual'
    WHEN 'delete_record' THEN 'manual'
    WHEN 'other' THEN 'manual'
  END $function$;

CREATE OR REPLACE FUNCTION public.review_proposed_change(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p public.bot_proposed_changes%ROWTYPE; k text; res jsonb; pl jsonb; inv public.invoices%ROWTYPE; err text;
BEGIN
  SELECT * INTO p FROM bot_proposed_changes WHERE id=p_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE='42501'; END IF;
  PERFORM public._bpc_admin_check(p.company_id);
  IF p.proposer_id = auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own proposal' USING ERRCODE='42501'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'Already %', p.status; END IF;
  IF NOT p_approve THEN
    UPDATE bot_proposed_changes SET status='rejected', reviewer_id=auth.uid(), reviewed_at=now(), review_note=p_note WHERE id=p.id;
    RETURN jsonb_build_object('status','rejected');
  END IF;
  k := public.bot_action_kind(p.action_type);
  IF k IS NULL THEN RAISE EXCEPTION 'Unknown action type %, cannot apply', p.action_type; END IF;
  IF k = 'manual' THEN
    UPDATE bot_proposed_changes SET status='approved', reviewer_id=auth.uid(), reviewed_at=now(), review_note=p_note WHERE id=p.id;
    RETURN jsonb_build_object('status','approved','note','Approved. Do this one in the app; nothing was changed automatically.');
  END IF;
  pl := p.payload;
  BEGIN
    CASE p.action_type
    WHEN 'invoice_send' THEN
      SELECT * INTO inv FROM invoices WHERE id=coalesce(p.target_id,(pl->>'invoice_id')::uuid) AND company_id=p.company_id;
      IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
      IF inv.status = 'draft' THEN
        UPDATE invoices SET status='sent', sent_method='email', sent_by=auth.uid(), updated_at=now() WHERE id=inv.id AND status='draft';
        res := jsonb_build_object('invoice_id',inv.id,'sent',true);
      ELSE
        res := public.invoice_send_now(inv.id);
      END IF;
    WHEN 'invoice_void' THEN
      SELECT * INTO inv FROM invoices WHERE id=coalesce(p.target_id,(pl->>'invoice_id')::uuid) AND company_id=p.company_id FOR UPDATE;
      IF inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
      IF EXISTS (SELECT 1 FROM payments WHERE invoice_id=inv.id AND status IN ('paid','succeeded','completed')) THEN RAISE EXCEPTION 'Invoice has payments; credit it instead'; END IF;
      UPDATE invoices SET status='void', updated_at=now() WHERE id=inv.id;
      res := jsonb_build_object('invoice_id',inv.id,'status','void');
    WHEN 'bank_unmatch' THEN
      PERFORM public.unmatch_bank_line(coalesce(p.target_id,(pl->>'line_id')::uuid)); res := jsonb_build_object('unmatched',true);
    WHEN 'bank_ignore' THEN
      res := public.confirm_bank_line(coalesce(p.target_id,(pl->>'line_id')::uuid), 'ignore', NULL, NULL, true, pl->>'note');
    WHEN 'bank_new_expense' THEN
      res := public.confirm_bank_line(coalesce(p.target_id,(pl->>'line_id')::uuid), 'new_expense', NULL, coalesce(pl->>'category','other'),
        coalesce((pl->>'vat_claimable')::boolean,true), pl->>'note');
    WHEN 'customer_set_rep' THEN
      res := public.set_customer_owner_rep(coalesce(p.target_id,(pl->>'customer_id')::uuid), nullif(pl->>'rep_id','')::uuid,
        coalesce(nullif(pl->>'reason',''),'WALDA proposal approved'));
      IF NOT coalesce((res->>'ok')::boolean,false) THEN RAISE EXCEPTION '%', res->>'message'; END IF;
    WHEN 'payment_cancel' THEN
      IF NOT EXISTS (SELECT 1 FROM payments WHERE id=coalesce(p.target_id,(pl->>'payment_id')::uuid) AND company_id=p.company_id) THEN RAISE EXCEPTION 'Payment not found'; END IF;
      UPDATE payments SET status='cancelled', reference=left(concat_ws(' ',reference,'(cancelled, WALDA proposal)'),200) WHERE id=coalesce(p.target_id,(pl->>'payment_id')::uuid);
      res := jsonb_build_object('cancelled',true);
    ELSE RAISE EXCEPTION 'Unknown action type %, cannot apply', p.action_type;
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    err := SQLERRM;
    UPDATE bot_proposed_changes SET status='failed', reviewer_id=auth.uid(), reviewed_at=now(), review_note=p_note, result=jsonb_build_object('error',err) WHERE id=p.id;
    RETURN jsonb_build_object('status','failed','error',err);
  END;
  UPDATE bot_proposed_changes SET status='applied', reviewer_id=auth.uid(), reviewed_at=now(), review_note=p_note, result=res, applied_at=now() WHERE id=p.id;
  PERFORM public._bot_audit(p.company_id, 'apply_'||p.action_type, p.target_table, p.target_id, NULL, res, p.id);
  RETURN jsonb_build_object('status','applied','result',res);
END $function$;

REVOKE ALL ON FUNCTION public.review_proposed_change(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_proposed_change(uuid, boolean, text) TO authenticated, service_role;
COMMIT;
