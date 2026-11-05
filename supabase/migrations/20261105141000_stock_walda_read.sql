-- WALDA read of the stock ledger, and stock_adjust becomes executable.
-- Depends on 20261105140000_stock_three_buckets.sql and on bot_proposed_changes / _walda_co (20261030220000).
-- Rollback restores the previous functions; see supabase/rollbacks/20261105140000_stock_three_buckets_rollback.sql

-- ---------- WALDA read + stock_adjust posts on approval (she cannot insert the movement) ----------
CREATE OR REPLACE FUNCTION public.bot_action_kind(p_type text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE p_type
    WHEN 'invoice_send' THEN 'executable'
    WHEN 'invoice_mark_sent' THEN 'executable'
    WHEN 'invoice_void' THEN 'executable'
    WHEN 'bank_unmatch' THEN 'executable'
    WHEN 'bank_ignore' THEN 'executable'
    WHEN 'bank_new_expense' THEN 'executable'
    WHEN 'customer_set_rep' THEN 'executable'
    WHEN 'payment_cancel' THEN 'executable'
    WHEN 'stock_adjust' THEN 'executable'
    WHEN 'catalogue_price_change' THEN 'manual'
    WHEN 'user_role_change' THEN 'manual'
    WHEN 'email_supplier' THEN 'manual'
    WHEN 'email_client' THEN 'manual'
    WHEN 'delete_record' THEN 'manual'
    WHEN 'other' THEN 'manual'
  END $function$;

CREATE OR REPLACE FUNCTION public.review_proposed_change(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    WHEN 'invoice_mark_sent' THEN
      DECLARE v_ids uuid[]; v_n int; v_ok int; v_prev text;
      BEGIN
        IF jsonb_typeof(pl->'invoice_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(pl->'invoice_ids') = 0 THEN
          RAISE EXCEPTION 'invoice_ids (list) needed';
        END IF;
        SELECT array_agg(DISTINCT x::uuid) INTO v_ids FROM jsonb_array_elements_text(pl->'invoice_ids') x;
        v_n := cardinality(v_ids);
        IF v_n > 200 THEN RAISE EXCEPTION 'Too many invoices in one batch (max 200)'; END IF;
        PERFORM 1 FROM invoices WHERE id = ANY(v_ids) AND company_id = p.company_id ORDER BY id FOR UPDATE;
        SELECT count(*) INTO v_ok FROM invoices WHERE id = ANY(v_ids) AND company_id = p.company_id;
        IF v_ok <> v_n THEN RAISE EXCEPTION '% of % invoices not found in this company', v_n - v_ok, v_n; END IF;
        SELECT count(*) INTO v_ok FROM invoices WHERE id = ANY(v_ids) AND company_id = p.company_id AND status = 'draft';
        IF v_ok <> v_n THEN
          RAISE EXCEPTION 'Only draft invoices can be marked sent; not draft: %',
            (SELECT string_agg(coalesce(invoice_number, id::text) || ' (' || coalesce(status,'?') || ')', ', ' ORDER BY invoice_number)
               FROM invoices WHERE id = ANY(v_ids) AND status IS DISTINCT FROM 'draft');
        END IF;
        v_prev := current_setting('app.invoice_skip_email', true);
        PERFORM set_config('app.invoice_skip_email', 'on', true);
        UPDATE invoices SET status='sent', sent_method='external', sent_by=auth.uid(), sent_at=coalesce(sent_at, now()),
               sent_note='sent from FreshBooks', updated_at=now()
         WHERE id = ANY(v_ids) AND company_id = p.company_id AND status = 'draft';
        GET DIAGNOSTICS v_ok = ROW_COUNT;
        PERFORM set_config('app.invoice_skip_email', coalesce(v_prev, ''), true);
        IF v_ok <> v_n THEN RAISE EXCEPTION 'Marked % of % invoices; nothing changed', v_ok, v_n; END IF;
        res := jsonb_build_object('marked_sent', v_ok, 'invoice_ids', to_jsonb(v_ids), 'sent_method', 'external', 'note', 'sent from FreshBooks');
      END;
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
    WHEN 'stock_adjust' THEN
      IF coalesce(trim(pl->>'reason'),'') = '' THEN RAISE EXCEPTION 'A stock adjustment needs a reason'; END IF;
      IF nullif(pl->>'stock_item_id','') IS NULL THEN RAISE EXCEPTION 'stock_item_id needed'; END IF;
      IF coalesce((pl->>'qty')::numeric, 0) = 0 THEN RAISE EXCEPTION 'Adjustment quantity cannot be zero'; END IF;
      res := jsonb_build_object('movement_id', public.stock_post_adjust(
        p.company_id, (pl->>'stock_item_id')::uuid, coalesce(nullif(pl->>'bucket',''), 'material_pool'),
        (pl->>'qty')::numeric, pl->>'reason', nullif(pl->>'count_line_id','')::uuid));
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

CREATE OR REPLACE FUNCTION public.walda_read_accounting(p_entity text, p_since timestamptz DEFAULT NULL, p_limit int DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); lim int := greatest(1,least(coalesce(p_limit,500),2000)); s timestamptz := coalesce(p_since,'-infinity'); r jsonb;
BEGIN
  CASE p_entity
  WHEN 'bank_lines' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT b.id,b.account_label,b.txn_date,b.amount,b.description,b.reference,b.status,b.matched_payment_id,b.matched_expense_id,b.matched_bill_payment_id,b.note,b.imported_at
      FROM bank_lines b WHERE b.company_id=co AND b.imported_at>=s ORDER BY b.txn_date DESC LIMIT lim) x;
  WHEN 'supplier_bills' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT b.id,b.supplier_id,b.supplier_name,b.po_id,b.job_id,b.bill_number,b.bill_date,b.due_date,b.amount_excl,b.vat_amount,b.amount_incl,b.amount_paid,b.status,b.created_at
      FROM supplier_bills b WHERE b.company_id=co AND b.updated_at>=s ORDER BY b.updated_at DESC LIMIT lim) x;
  WHEN 'expenses' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT e.id,e.expense_date,e.supplier_name,e.category,e.amount_incl,e.reference,e.status
      FROM expenses e WHERE e.company_id=co AND e.created_at>=s ORDER BY e.expense_date DESC LIMIT lim) x;
  WHEN 'my_audit' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT a.id,a.action,a.target_table,a.target_id,a.proposal_id,a.created_at FROM bot_audit_log a WHERE a.company_id=co AND a.actor_id=auth.uid() AND a.created_at>=s ORDER BY a.created_at DESC LIMIT lim) x;
  WHEN 'my_proposals' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT p.id,p.action_type,p.target_table,p.target_id,p.summary,p.status,p.review_note,p.result,p.created_at,p.reviewed_at FROM bot_proposed_changes p WHERE p.company_id=co AND p.proposer_id=auth.uid() AND p.created_at>=s ORDER BY p.created_at DESC LIMIT lim) x;
  WHEN 'stock_movements' THEN SELECT jsonb_agg(x) INTO r FROM (
      SELECT m.id, m.kind, m.bucket, m.stock_item_id, m.item_label, m.qty, m.unit_cost_excl, m.vat_amount, m.job_id,
             m.supplier_document_id, m.supplier_document_line_id, m.serial_no, m.unit_id, m.reason, m.allowance_id, m.created_by, m.created_at
        FROM stock_movements m WHERE m.company_id=co AND m.created_at>=s ORDER BY m.created_at DESC LIMIT lim) x;
  WHEN 'stock_value' THEN SELECT jsonb_agg(x) INTO r FROM (
      SELECT bucket, stock_item_id, item_label, qty, value_excl FROM stock_value_as_of(co, now())) x;
  WHEN 'job_stock_cost' THEN SELECT jsonb_agg(x) INTO r FROM (
      SELECT job_id, unit_cost_excl, material_cost_excl, unit_cost_excl + material_cost_excl AS total_excl
        FROM job_stock_cost WHERE company_id=co) x;
  WHEN 'material_allowances' THEN SELECT jsonb_agg(x) INTO r FROM (
      SELECT a.id, a.job_type, a.unit_size, a.product_id, a.item_label, a.stock_unit, a.qty, a.rate_note, a.effective_from, a.effective_to, a.active
        FROM material_allowances a WHERE a.company_id=co ORDER BY a.unit_size NULLS LAST, a.item_label LIMIT lim) x;
  WHEN 'stock_counts' THEN SELECT jsonb_agg(x) INTO r FROM (
      SELECT c.id, c.counted_on, c.status, c.note, c.posted_at,
             (SELECT jsonb_agg(jsonb_build_object('stock_item_id', l.stock_item_id, 'bucket', l.bucket, 'system_qty', l.system_qty, 'counted_qty', l.counted_qty, 'reason', l.reason, 'movement_id', l.movement_id))
                FROM stock_count_lines l WHERE l.count_id = c.id) AS lines
        FROM stock_counts c WHERE c.company_id=co AND c.created_at>=s ORDER BY c.counted_on DESC LIMIT lim) x;
  WHEN 'supplier_doc_bank_links' THEN SELECT jsonb_agg(x) INTO r FROM (
      SELECT k.id, k.supplier_document_id, k.bank_line_id, k.amount_excl, k.note, k.created_at
        FROM supplier_doc_bank_links k WHERE k.company_id=co AND k.created_at>=s ORDER BY k.created_at DESC LIMIT lim) x;
  ELSE RAISE EXCEPTION 'unknown entity %', p_entity;
  END CASE;
  RETURN coalesce(r,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.walda_read_accounting(text, timestamptz, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_read_accounting(text, timestamptz, int) TO authenticated;
