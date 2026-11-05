-- Rollback for 20261105140000_stock_three_buckets.sql
-- Restores sjd_receive, bot_action_kind, review_proposed_change and walda_read_accounting
-- to the versions that were current before this migration. Does not delete historical rows
-- except by dropping the new tables (movements, units, allowances, counts, bank-link stub).
-- Run only if those tables have not been relied on. No other company data is touched.

DROP TRIGGER IF EXISTS stock_allowance_on_complete ON public.jobs;
DROP VIEW IF EXISTS public.job_stock_cost;
DROP VIEW IF EXISTS public.stock_value_by_bucket;

-- previous WALDA functions (stock_adjust is manual again)
CREATE OR REPLACE FUNCTION public.bot_action_kind(p_type text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_type
    WHEN 'invoice_send' THEN 'executable'
    WHEN 'invoice_mark_sent' THEN 'executable'
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
    WHEN 'invoice_mark_sent' THEN
      -- Invoices already sent to the client outside the app (FreshBooks). Batch: one approval, many invoices.
      -- Draft -> sent only; no client email, no outbox; all-or-nothing (any bad id fails the whole proposal).
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

-- previous WALDA read (no stock entities)
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
  ELSE RAISE EXCEPTION 'unknown entity %', p_entity;
  END CASE;
  RETURN coalesce(r,'[]'::jsonb);
END $$;

-- previous sjd_receive (pair price, no ledger)
-- Reserving pair halves (indoor + outdoor) puts the full pair price on the one Projects line.
CREATE OR REPLACE FUNCTION public.sjd_receive(p_document uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.supplier_job_documents; ln jsonb; l public.supplier_job_document_lines; s public.cf_stock_items;
  v_inv boolean; v_action text; v_job uuid; v_pack numeric; v_qty numeric; v_cost numeric; v_unit_cost numeric; v_com uuid; v_free numeric; v_pair numeric;
  n_stock int := 0; n_res int := 0; n_inst int := 0; n_skip int := 0; n_done int := 0; out jsonb := '[]'::jsonb; v_msg text;
BEGIN
  SELECT * INTO d FROM public.supplier_job_documents WHERE id = p_document FOR UPDATE;
  IF d.id IS NULL OR NOT public._cf_ok(d.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  v_inv := d.doc_type = 'supplier_invoice';
  IF d.doc_type NOT IN ('supplier_invoice','delivery_note') THEN RAISE EXCEPTION 'Only delivery notes and supplier invoices can be received'; END IF;

  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    SELECT * INTO l FROM public.supplier_job_document_lines WHERE id = (ln->>'line_id')::uuid AND document_id = d.id FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Line % is not on this document', ln->>'line_id'; END IF;
    IF l.received_at IS NOT NULL THEN n_done := n_done + 1; CONTINUE; END IF;           -- idempotent
    v_action := coalesce(ln->>'action','skip');
    v_job := nullif(ln->>'job_id','')::uuid;
    IF v_action IN ('reserve','installed') THEN
      IF v_job IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job AND company_id = d.company_id) THEN RAISE EXCEPTION 'Line %: pick a job of this company', l.line_no; END IF;
    END IF;
    v_pack := coalesce(nullif(ln->>'pack_size','')::numeric, 1);
    v_qty  := round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1) * v_pack, 3);
    v_cost := nullif(ln->>'unit_cost_pack','')::numeric;
    v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_pack, 4) END;
    -- pair halves (indoor + outdoor = different model numbers, same product and job) share one Projects line:
    -- its cost is the full pair price (sum of one half of each model), never just the first half.
    IF v_action = 'reserve' THEN
      SELECT round(sum(c), 4) INTO v_pair FROM (
        SELECT DISTINCT ON (coalesce(nullif(l2.model_number,''), l2.id::text))
               nullif(x->>'unit_cost_pack','')::numeric / coalesce(nullif(x->>'pack_size','')::numeric, 1) AS c
        FROM jsonb_array_elements(p_lines) x
        JOIN public.supplier_job_document_lines l2 ON l2.id = (x->>'line_id')::uuid AND l2.document_id = d.id
        WHERE x->>'action' = 'reserve' AND x->>'job_id' = ln->>'job_id' AND x->>'product_id' = ln->>'product_id'
        ORDER BY coalesce(nullif(l2.model_number,''), l2.id::text), l2.line_no) h;
      IF v_pair IS NULL OR nullif(ln->>'product_id','') IS NULL THEN v_pair := v_unit_cost; END IF;
    END IF;
    s := NULL; v_msg := NULL;

    IF v_action = 'skip' THEN n_skip := n_skip + 1;
    ELSIF v_action = 'installed' THEN
      -- supplied straight to site: record on the job, never touches stock
      INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by)
      VALUES (d.company_id, v_job, left(coalesce(ln->>'item', l.description, l.model_number,'Item'),160), v_qty, NULL, false, 0,
              'Supplied direct: ' || coalesce(d.doc_number, 'supplier doc'), auth.uid());
      n_inst := n_inst + 1;
    ELSIF NOT v_inv THEN
      -- delivery note: no stock until the invoice; a reserve makes sure the Projects line exists
      IF v_action = 'reserve' THEN
        PERFORM public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1), v_pair, l.id, d.supplier_name);
        n_res := n_res + 1;
      ELSE v_action := 'pending'; n_stock := n_stock + 1; END IF;
      v_qty := 0;
    ELSE
      -- invoice: add stock at invoice cost (weighted average), then reserve if asked
      s := public._stock_item_for(d.company_id, nullif(ln->>'product_id','')::uuid, ln->>'model_code', coalesce(ln->>'item', l.description), ln->>'stock_unit', v_pack);
      UPDATE public.cf_stock_items SET
        unit_cost_excl = CASE WHEN v_unit_cost IS NULL THEN unit_cost_excl
                              WHEN qty_on_hand + v_qty <= 0 THEN v_unit_cost
                              ELSE round((qty_on_hand * coalesce(unit_cost_excl,0) + v_qty * v_unit_cost) / (qty_on_hand + v_qty), 4) END,
        qty_on_hand = qty_on_hand + v_qty, last_received_at = now(), updated_at = now()
      WHERE id = s.id;
      n_stock := n_stock + 1;
      IF v_action = 'reserve' THEN
        v_com := public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), v_qty, v_pair, l.id, d.supplier_name);
        v_free := least(v_qty, (SELECT c.qty - coalesce((SELECT sum(a.qty) FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id AND a.drawn_at IS NULL),0)
                                 FROM public.cf_commitments c WHERE c.id = v_com));
        IF v_free > 0 AND (SELECT status FROM public.cf_commitments WHERE id = v_com) <> 'installed' THEN
          PERFORM public.cf_allocate_stock(v_com, s.id, v_free);
        ELSE v_msg := 'Projects line already covered or installed: left in free stock'; END IF;
        n_res := n_res + 1;
      END IF;
    END IF;

    UPDATE public.supplier_job_document_lines SET
      product_id = nullif(ln->>'product_id','')::uuid, unit_cost_excl = v_cost, cost_source = nullif(ln->>'cost_source',''),
      receive_action = v_action, receive_job_id = v_job, stock_item_id = s.id, stock_qty = CASE WHEN v_inv AND v_action IN ('stock','reserve') THEN v_qty ELSE 0 END,
      price_flag = nullif(ln->>'price_flag',''), price_note = concat_ws(' · ', nullif(ln->>'price_note',''), v_msg),
      received_at = now(), received_by = auth.uid()
    WHERE id = l.id;
    out := out || jsonb_build_object('line_id', l.id, 'action', v_action, 'stock_item_id', s.id, 'stock_qty', v_qty, 'note', v_msg);
  END LOOP;
  RETURN jsonb_build_object('stocked', n_stock, 'reserved', n_res, 'installed', n_inst, 'skipped', n_skip, 'already_received', n_done, 'lines', out);
END $$;
REVOKE ALL ON FUNCTION public.sjd_receive(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_receive(uuid, jsonb) TO authenticated;

\n
DROP FUNCTION IF EXISTS public.stock_count_post(uuid);
DROP FUNCTION IF EXISTS public.stock_count_save(uuid, date, jsonb);
DROP FUNCTION IF EXISTS public.stock_post_adjust(uuid, uuid, text, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.stock_general_units(uuid);
DROP FUNCTION IF EXISTS public.stock_on_hand(uuid);
DROP FUNCTION IF EXISTS public.stock_value_as_of(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.material_allowance_seed_stubs(uuid);
DROP FUNCTION IF EXISTS public.job_confirm_unit_serial(uuid, text);
DROP FUNCTION IF EXISTS public.job_units_for_tech(uuid);
DROP FUNCTION IF EXISTS public.stock_allowance_on_complete();
DROP FUNCTION IF EXISTS public.job_apply_material_allowances(uuid);
DROP FUNCTION IF EXISTS public.stock_assign_unit(uuid, uuid);
DROP FUNCTION IF EXISTS public.material_avg_cost(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.stock_unit_size_key(text);
DROP FUNCTION IF EXISTS public.job_book_out_units(uuid);
DROP FUNCTION IF EXISTS public.stock_awaiting(uuid);
DROP FUNCTION IF EXISTS public._sjd_match_line(uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.stock_qty_counts(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.stock_qty_counts(text, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public._stock_model_key(text);
DROP FUNCTION IF EXISTS public._stock_move(uuid, text, text, uuid, uuid, text, numeric, numeric, numeric, uuid, uuid, uuid, text, uuid, text, uuid, uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public._stock_move(uuid, text, text, uuid, uuid, text, numeric, numeric, numeric, uuid, uuid, uuid, text, uuid, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._stock_reject_bot();
DROP FUNCTION IF EXISTS public._stock_accounts_ok(uuid);

DROP TABLE IF EXISTS public.stock_movements;
DROP TABLE IF EXISTS public.stock_count_lines;
DROP TABLE IF EXISTS public.stock_counts;
DROP TABLE IF EXISTS public.material_allowances;
DROP TABLE IF EXISTS public.stock_units;
DROP TABLE IF EXISTS public.supplier_doc_bank_links;

ALTER TABLE public.supplier_job_document_lines DROP CONSTRAINT IF EXISTS supplier_job_document_lines_receive_bucket_chk;
ALTER TABLE public.supplier_job_document_lines DROP CONSTRAINT IF EXISTS sjdl_one_match;
DROP INDEX IF EXISTS public.sjdl_one_match;
ALTER TABLE public.supplier_job_document_lines
  DROP COLUMN IF EXISTS cost_missing,
  DROP COLUMN IF EXISTS delivered_with_doc,
  DROP COLUMN IF EXISTS posts_qty,
  DROP COLUMN IF EXISTS credits_line_id,
  DROP COLUMN IF EXISTS matched_line_id,
  DROP COLUMN IF EXISTS receive_bucket,
  DROP COLUMN IF EXISTS vat_amount,
  DROP COLUMN IF EXISTS vat_rate;

DROP FUNCTION IF EXISTS public.stock_units_guard();
DROP FUNCTION IF EXISTS public.stock_movements_guard();

