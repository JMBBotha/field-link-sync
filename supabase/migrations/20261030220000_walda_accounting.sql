-- WALDA accounting role (Johan 30 Oct 16:14): a few direct accounting writes via SECURITY DEFINER RPCs (all audited),
-- everything else goes to bot_proposed_changes for an admin to approve. Bot keeps zz_no_accounts_bot (no direct table access).
-- Re-runnable. Rollback: /workspace/walda-accounting-2026-10-30/rollback.sql

-- ---------- audit ----------
CREATE TABLE IF NOT EXISTS public.bot_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_table text, target_id uuid,
  before jsonb, after jsonb,
  proposal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_audit_log_co_idx ON public.bot_audit_log(company_id, created_at DESC);
ALTER TABLE public.bot_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_audit_log FROM anon, authenticated;
GRANT SELECT ON public.bot_audit_log TO authenticated;
DROP POLICY IF EXISTS bot_audit_admin_read ON public.bot_audit_log;
CREATE POLICY bot_audit_admin_read ON public.bot_audit_log FOR SELECT TO authenticated
  USING (public.fl_is_company_admin(auth.uid(), company_id) AND NOT public.is_sales_rep(auth.uid()));
DROP POLICY IF EXISTS zz_no_accounts_bot ON public.bot_audit_log;
CREATE POLICY zz_no_accounts_bot ON public.bot_audit_log AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (SELECT public.is_accounts_bot())) WITH CHECK (NOT (SELECT public.is_accounts_bot()));

CREATE OR REPLACE FUNCTION public._bot_audit(p_co uuid, p_action text, p_table text, p_id uuid, p_before jsonb, p_after jsonb, p_proposal uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.bot_audit_log(company_id, actor_id, action, target_table, target_id, before, after, proposal_id)
  VALUES (p_co, auth.uid(), p_action, p_table, p_id, p_before, p_after, p_proposal);
$$;
REVOKE ALL ON FUNCTION public._bot_audit(uuid,text,text,uuid,jsonb,jsonb,uuid) FROM PUBLIC, anon, authenticated;

-- enabled bot company or error
CREATE OR REPLACE FUNCTION public._walda_co() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public.accounts_bot_company();
BEGIN IF co IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF; RETURN co; END $$;
REVOKE ALL ON FUNCTION public._walda_co() FROM PUBLIC, anon, authenticated;

-- ---------- 1. draft invoices (never sent; status stays draft) ----------
CREATE OR REPLACE FUNCTION public.walda_invoice_draft_save(p_invoice_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); f jsonb := coalesce(p_fields,'{}'::jsonb); o public.invoices%ROWTYPE; n public.invoices%ROWTYPE;
  bad text; v_id uuid; v_profile uuid; v_num text; v_agent uuid; cp public.company_profiles%ROWTYPE; v_no int;
  allowed text[] := ARRAY['customer_id','customer_name','customer_email','customer_phone','customer_address','line_items','subtotal','tax_rate','tax_amount',
    'grand_total','notes','due_date','issue_date','quote_id','lead_id','payment_terms_basis','payment_terms_days','discount_type','discount_value','discount_amount',
    'deposit_type','deposit_value','billed_to_vat_number'];
BEGIN
  SELECT k INTO bad FROM jsonb_object_keys(f) k WHERE k <> ALL(allowed) LIMIT 1;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'field % cannot be set by WALDA', bad USING ERRCODE='42501'; END IF;
  IF f ? 'customer_id' AND nullif(f->>'customer_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=(f->>'customer_id')::uuid AND company_id=co) THEN
    RAISE EXCEPTION 'client not found' USING ERRCODE='42501'; END IF;
  IF f ? 'quote_id' AND nullif(f->>'quote_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM quotes WHERE id=(f->>'quote_id')::uuid AND company_id=co) THEN
    RAISE EXCEPTION 'quote not found' USING ERRCODE='42501'; END IF;
  IF f ? 'lead_id' AND nullif(f->>'lead_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads WHERE id=(f->>'lead_id')::uuid AND company_id=co) THEN
    RAISE EXCEPTION 'lead not found' USING ERRCODE='42501'; END IF;
  IF p_invoice_id IS NULL THEN
    -- invoice owner: quote's rep, else the company's first admin (WALDA is never an agent)
    SELECT q.sales_engineer_id INTO v_agent FROM quotes q WHERE q.id = nullif(f->>'quote_id','')::uuid;
    IF v_agent IS NULL THEN SELECT cm.user_id INTO v_agent FROM company_members cm WHERE cm.company_id=co AND cm.role='admin' ORDER BY cm.created_at LIMIT 1; END IF;
    v_profile := public.default_company_profile(co);
    SELECT * INTO cp FROM company_profiles WHERE id=v_profile AND archived_at IS NULL FOR UPDATE;
    IF cp.id IS NULL OR cp.use_shared_sequence THEN v_num := public.generate_invoice_number();
    ELSE LOOP
      v_no := cp.next_invoice_no;
      UPDATE company_profiles SET next_invoice_no = v_no + 1, updated_at = now() WHERE id = cp.id RETURNING next_invoice_no INTO cp.next_invoice_no;
      v_num := cp.invoice_prefix || lpad(v_no::text, cp.number_pad, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = v_num);
    END LOOP; END IF;
    INSERT INTO invoices(invoice_number, agent_id, company_id, company_profile_id, status, customer_name)
    VALUES (v_num, v_agent, co, v_profile, 'draft', coalesce(nullif(f->>'customer_name',''), 'Client')) RETURNING * INTO o;
    v_id := o.id; o := NULL;
  ELSE
    SELECT * INTO o FROM invoices WHERE id=p_invoice_id FOR UPDATE;
    IF o.id IS NULL OR o.company_id IS DISTINCT FROM co THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
    IF coalesce(o.status,'draft') <> 'draft' THEN RAISE EXCEPTION 'Invoice % is %, only drafts can be edited (propose a change instead)', o.invoice_number, o.status USING ERRCODE='42501'; END IF;
    v_id := o.id;
  END IF;
  UPDATE invoices i SET
    customer_id = CASE WHEN f ? 'customer_id' THEN nullif(f->>'customer_id','')::uuid ELSE i.customer_id END,
    customer_name = CASE WHEN f ? 'customer_name' THEN coalesce(nullif(f->>'customer_name',''), i.customer_name) ELSE i.customer_name END,
    customer_email = CASE WHEN f ? 'customer_email' THEN f->>'customer_email' ELSE i.customer_email END,
    customer_phone = CASE WHEN f ? 'customer_phone' THEN f->>'customer_phone' ELSE i.customer_phone END,
    customer_address = CASE WHEN f ? 'customer_address' THEN f->>'customer_address' ELSE i.customer_address END,
    line_items = CASE WHEN f ? 'line_items' THEN f->'line_items' ELSE i.line_items END,
    subtotal = CASE WHEN f ? 'subtotal' THEN (f->>'subtotal')::numeric ELSE i.subtotal END,
    tax_rate = CASE WHEN f ? 'tax_rate' THEN (f->>'tax_rate')::numeric ELSE i.tax_rate END,
    tax_amount = CASE WHEN f ? 'tax_amount' THEN (f->>'tax_amount')::numeric ELSE i.tax_amount END,
    grand_total = CASE WHEN f ? 'grand_total' THEN (f->>'grand_total')::numeric ELSE i.grand_total END,
    notes = CASE WHEN f ? 'notes' THEN f->>'notes' ELSE i.notes END,
    due_date = CASE WHEN f ? 'due_date' THEN nullif(f->>'due_date','')::date ELSE i.due_date END,
    issue_date = CASE WHEN f ? 'issue_date' THEN nullif(f->>'issue_date','')::date ELSE i.issue_date END,
    quote_id = CASE WHEN f ? 'quote_id' THEN nullif(f->>'quote_id','')::uuid ELSE i.quote_id END,
    lead_id = CASE WHEN f ? 'lead_id' THEN nullif(f->>'lead_id','')::uuid ELSE i.lead_id END,
    payment_terms_basis = CASE WHEN f ? 'payment_terms_basis' THEN nullif(f->>'payment_terms_basis','') ELSE i.payment_terms_basis END,
    payment_terms_days = CASE WHEN f ? 'payment_terms_days' THEN nullif(f->>'payment_terms_days','')::int ELSE i.payment_terms_days END,
    discount_type = CASE WHEN f ? 'discount_type' THEN nullif(f->>'discount_type','') ELSE i.discount_type END,
    discount_value = CASE WHEN f ? 'discount_value' THEN nullif(f->>'discount_value','')::numeric ELSE i.discount_value END,
    discount_amount = CASE WHEN f ? 'discount_amount' THEN nullif(f->>'discount_amount','')::numeric ELSE i.discount_amount END,
    deposit_type = CASE WHEN f ? 'deposit_type' THEN nullif(f->>'deposit_type','') ELSE i.deposit_type END,
    deposit_value = CASE WHEN f ? 'deposit_value' THEN nullif(f->>'deposit_value','')::numeric ELSE i.deposit_value END,
    billed_to_vat_number = CASE WHEN f ? 'billed_to_vat_number' THEN nullif(f->>'billed_to_vat_number','') ELSE i.billed_to_vat_number END,
    updated_at = now()
  WHERE i.id = v_id AND i.status = 'draft' RETURNING * INTO n;
  PERFORM public._bot_audit(co, CASE WHEN p_invoice_id IS NULL THEN 'invoice_draft_create' ELSE 'invoice_draft_edit' END, 'invoices', v_id,
    CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o) END, to_jsonb(n));
  RETURN jsonb_build_object('invoice_id', v_id, 'invoice_number', n.invoice_number, 'status', n.status);
END $$;

-- ---------- 2. payments against sent invoices (optionally straight from a bank line) ----------
CREATE OR REPLACE FUNCTION public.walda_record_payment(p_invoice_id uuid, p_amount numeric, p_method text DEFAULT 'eft', p_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE, p_bank_line_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); v public.invoices%ROWTYPE; l public.bank_lines%ROWTYPE; v_out numeric; v_amt numeric := p_amount; v_id uuid;
BEGIN
  SELECT * INTO v FROM invoices WHERE id=p_invoice_id FOR UPDATE;
  IF v.id IS NULL OR v.company_id IS DISTINCT FROM co THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF coalesce(v.status,'draft') IN ('draft','void','cancelled') THEN RAISE EXCEPTION 'Invoice % is %', v.invoice_number, coalesce(v.status,'draft'); END IF;
  IF p_bank_line_id IS NOT NULL THEN
    SELECT * INTO l FROM bank_lines WHERE id=p_bank_line_id AND company_id=co FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Bank line not found'; END IF;
    IF l.status <> 'new' THEN RAISE EXCEPTION 'This bank line is already %', l.status; END IF;
    IF l.amount <= 0 THEN RAISE EXCEPTION 'Only money in can pay an invoice'; END IF;
    v_amt := l.amount;
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero'; END IF;
  IF coalesce(p_method,'eft') NOT IN ('cash','eft','card','other') THEN RAISE EXCEPTION 'method must be cash, eft, card or other'; END IF;
  v_out := round(coalesce(v.grand_total,0) - coalesce((SELECT sum(amount) FROM payments WHERE invoice_id=v.id AND status IN ('paid','succeeded','completed')),0) - public.invoice_amount_credited(v.id), 2);
  IF v_amt > v_out + 0.01 THEN RAISE EXCEPTION 'Amount R% is more than the R% outstanding on %', v_amt, v_out, v.invoice_number; END IF;
  INSERT INTO payments(invoice_id, amount, method, reference, payment_date, gateway, status, company_id, created_by)
  VALUES (v.id, v_amt, coalesce(p_method,'eft'), left(coalesce(p_reference, concat_ws(' ','Bank',l.reference,l.description)),200),
          coalesce(l.txn_date, p_payment_date, CURRENT_DATE), 'manual', 'paid', co, auth.uid()) RETURNING id INTO v_id;
  IF l.id IS NOT NULL THEN
    UPDATE bank_lines SET status='matched', matched_payment_id=v_id, created_record=true, matched_by=auth.uid(), matched_at=now(), note=coalesce(note,'WALDA') WHERE id=l.id;
  END IF;
  PERFORM public._bot_audit(co, 'payment_record', 'payments', v_id, NULL,
    jsonb_build_object('invoice_id',v.id,'invoice_number',v.invoice_number,'amount',v_amt,'bank_line_id',l.id,'outstanding_before',v_out));
  RETURN jsonb_build_object('payment_id', v_id, 'amount', v_amt, 'outstanding_after', v_out - v_amt);
END $$;

-- ---------- 3. bank recon matching (no unmatch, no ignore, no new expense: those are proposals) ----------
-- p_kind: 'payment' (existing client payment), 'expense' (existing expense), 'supplier_bill' (pays a supplier bill from the line)
CREATE OR REPLACE FUNCTION public.walda_bank_match(p_line_id uuid, p_kind text, p_target uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); l public.bank_lines%ROWTYPE; b public.supplier_bills%ROWTYPE; v_id uuid; v_out numeric;
BEGIN
  SELECT * INTO l FROM bank_lines WHERE id=p_line_id FOR UPDATE;
  IF l.id IS NULL OR l.company_id IS DISTINCT FROM co THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF l.status <> 'new' THEN RAISE EXCEPTION 'This bank line is already %', l.status; END IF;
  IF p_kind = 'payment' THEN
    IF NOT EXISTS (SELECT 1 FROM payments p WHERE p.id=p_target AND p.company_id=co AND p.status IN ('paid','succeeded','completed') AND abs(p.amount-l.amount)<0.01)
       OR EXISTS (SELECT 1 FROM bank_lines x WHERE x.matched_payment_id=p_target) THEN
      RAISE EXCEPTION 'Payment not found, already matched, or amount differs'; END IF;
    UPDATE bank_lines SET status='matched', matched_payment_id=p_target, matched_by=auth.uid(), matched_at=now(), note=p_note WHERE id=l.id;
    v_id := p_target;
  ELSIF p_kind = 'expense' THEN
    IF NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id=p_target AND e.company_id=co AND e.status='active' AND abs(e.amount_incl + l.amount)<0.01) THEN
      RAISE EXCEPTION 'Expense not found or amount differs'; END IF;
    UPDATE bank_lines SET status='matched', matched_expense_id=p_target, matched_by=auth.uid(), matched_at=now(), note=p_note WHERE id=l.id;
    v_id := p_target;
  ELSIF p_kind = 'supplier_bill' THEN
    SELECT * INTO b FROM supplier_bills WHERE id=p_target AND company_id=co FOR UPDATE;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
    IF b.status = 'void' THEN RAISE EXCEPTION 'Bill is void'; END IF;
    IF l.amount >= 0 THEN RAISE EXCEPTION 'Only money out can pay a supplier bill'; END IF;
    v_out := round(b.amount_incl - b.amount_paid, 2);
    IF -l.amount > v_out + 0.01 THEN RAISE EXCEPTION 'Amount R% is more than the R% still owed', -l.amount, v_out; END IF;
    INSERT INTO supplier_bill_payments(bill_id, company_id, amount, paid_date, method, reference, bank_line_id, created_by)
    VALUES (b.id, co, -l.amount, l.txn_date, 'eft', left(concat_ws(' ', l.reference, l.description),200), l.id, auth.uid()) RETURNING id INTO v_id;
    UPDATE bank_lines SET status='matched', matched_bill_payment_id=v_id, created_record=true, matched_by=auth.uid(), matched_at=now(),
      note=coalesce(p_note, 'Supplier bill '||coalesce(b.bill_number,'')) WHERE id=l.id;
    IF b.status = 'draft' THEN UPDATE supplier_bills SET status='unpaid' WHERE id=b.id; PERFORM public._sb_recalc(b.id); END IF;
  ELSE
    RAISE EXCEPTION 'WALDA can match to payment, expense or supplier_bill only (propose anything else)' USING ERRCODE='42501';
  END IF;
  PERFORM public._bot_audit(co, 'bank_match_'||p_kind, 'bank_lines', l.id, to_jsonb(l), (SELECT to_jsonb(x) FROM bank_lines x WHERE x.id=l.id));
  RETURN jsonb_build_object('line', l.id, 'kind', p_kind, 'record', v_id);
END $$;

-- ---------- 4. supplier document links ----------
CREATE OR REPLACE FUNCTION public.walda_sjd_link(p_document_id uuid, p_job_id uuid DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_line_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); k uuid; cust uuid := p_customer_id; b jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supplier_job_documents WHERE id=p_document_id AND company_id=co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE id=p_job_id AND company_id=co) THEN RAISE EXCEPTION 'job not found' USING ERRCODE='42501'; END IF;
  IF cust IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=cust AND company_id=co) THEN RAISE EXCEPTION 'client not found' USING ERRCODE='42501'; END IF;
  IF p_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supplier_job_document_lines WHERE id=p_line_id AND document_id=p_document_id) THEN RAISE EXCEPTION 'line not found'; END IF;
  IF p_job_id IS NULL AND cust IS NULL THEN RAISE EXCEPTION 'pick a job or a client'; END IF;
  IF p_job_id IS NOT NULL AND cust IS NULL THEN SELECT customer_id INTO cust FROM jobs WHERE id=p_job_id; END IF;
  SELECT id, to_jsonb(x) INTO k, b FROM supplier_job_document_links x WHERE document_id=p_document_id
    AND coalesce(job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND (p_job_id IS NOT NULL OR customer_id=cust) LIMIT 1;
  IF k IS NULL THEN
    INSERT INTO supplier_job_document_links(document_id,company_id,job_id,customer_id,line_id,status,confirmed_by,confirmed_at,suggested_by)
    VALUES (p_document_id,co,p_job_id,cust,p_line_id,'confirmed',auth.uid(),now(),'WALDA (bot)') RETURNING id INTO k;
  ELSE
    UPDATE supplier_job_document_links SET status='confirmed', confirmed_by=auth.uid(), confirmed_at=now(),
      customer_id=coalesce(customer_id,cust), line_id=coalesce(p_line_id,line_id) WHERE id=k;
  END IF;
  IF p_job_id IS NOT NULL THEN
    UPDATE supplier_job_document_lines SET job_id=p_job_id
      WHERE document_id=p_document_id AND (id=p_line_id OR id IN (SELECT line_id FROM supplier_job_document_links WHERE id=k));
    PERFORM public.sjd_match_units(p_document_id);
  END IF;
  PERFORM public._bot_audit(co, 'sjd_link', 'supplier_job_document_links', k, b, (SELECT to_jsonb(x) FROM supplier_job_document_links x WHERE x.id=k));
  RETURN k;
END $$;

CREATE OR REPLACE FUNCTION public.walda_sjd_confirm(p_link_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); x public.supplier_job_document_links%ROWTYPE;
BEGIN
  SELECT * INTO x FROM supplier_job_document_links WHERE id=p_link_id;
  IF x.id IS NULL OR x.company_id IS DISTINCT FROM co THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN public.walda_sjd_link(x.document_id, x.job_id, x.customer_id, x.line_id);
END $$;

-- ---------- 5. unit model / serial on a job ----------
-- p_unit_id NULL = add a unit row; else update model/serial/brand of that row (before/after audited).
CREATE OR REPLACE FUNCTION public.walda_job_unit_save(p_job_id uuid, p_unit_id uuid DEFAULT NULL, p_brand text DEFAULT NULL, p_model text DEFAULT NULL,
  p_serial text DEFAULT NULL, p_position text DEFAULT NULL, p_label text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); o public.job_unit_details%ROWTYPE; v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jobs WHERE id=p_job_id AND company_id=co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF nullif(trim(coalesce(p_model,'')||coalesce(p_serial,'')),'') IS NULL THEN RAISE EXCEPTION 'model or serial needed'; END IF;
  IF p_unit_id IS NULL THEN
    INSERT INTO job_unit_details(company_id, job_id, unit_label, position, brand, model, serial_number, entered_by, entered_at, occurred_at)
    VALUES (co, p_job_id, nullif(trim(p_label),''), nullif(trim(p_position),''), nullif(trim(p_brand),''), nullif(trim(p_model),''), nullif(trim(p_serial),''), auth.uid(), now(), now())
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO o FROM job_unit_details WHERE id=p_unit_id AND job_id=p_job_id AND company_id=co FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'unit not found' USING ERRCODE='42501'; END IF;
    UPDATE job_unit_details SET brand=coalesce(nullif(trim(p_brand),''),brand), model=coalesce(nullif(trim(p_model),''),model),
      serial_number=coalesce(nullif(trim(p_serial),''),serial_number), position=coalesce(nullif(trim(p_position),''),position),
      unit_label=coalesce(nullif(trim(p_label),''),unit_label) WHERE id=o.id;
    v_id := o.id;
  END IF;
  PERFORM public._bot_audit(co, CASE WHEN p_unit_id IS NULL THEN 'unit_add' ELSE 'unit_edit' END, 'job_unit_details', v_id,
    CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o) END, (SELECT to_jsonb(x) FROM job_unit_details x WHERE x.id=v_id));
  RETURN v_id;
END $$;

-- WALDA reads her own audit trail + bank lines + supplier bills (company-scoped, minimal columns)
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

-- ---------- proposed changes ----------
CREATE TABLE IF NOT EXISTS public.bot_proposed_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  proposer_id uuid NOT NULL,
  action_type text NOT NULL,
  target_table text, target_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  reason text,
  checked_note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied','failed')),
  reviewer_id uuid, reviewed_at timestamptz, review_note text,
  result jsonb, applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_proposed_changes_pending_idx ON public.bot_proposed_changes(company_id, status, created_at DESC);
ALTER TABLE public.bot_proposed_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_proposed_changes FROM anon, authenticated;
GRANT SELECT ON public.bot_proposed_changes TO authenticated;
DROP POLICY IF EXISTS bpc_admin_read ON public.bot_proposed_changes;
CREATE POLICY bpc_admin_read ON public.bot_proposed_changes FOR SELECT TO authenticated
  USING (public.fl_is_company_admin(auth.uid(), company_id) AND NOT public.is_sales_rep(auth.uid()));
DROP POLICY IF EXISTS zz_no_accounts_bot ON public.bot_proposed_changes;
CREATE POLICY zz_no_accounts_bot ON public.bot_proposed_changes AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (SELECT public.is_accounts_bot())) WITH CHECK (NOT (SELECT public.is_accounts_bot()));

-- Action types. executable = Approve runs it via the dispatcher; manual = Approve only records the OK (Johan/office does it in the app).
CREATE OR REPLACE FUNCTION public.bot_action_kind(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
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
  END $$;

CREATE OR REPLACE FUNCTION public.propose_change(p_action_type text, p_summary text, p_payload jsonb DEFAULT '{}'::jsonb, p_target_table text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL, p_reason text DEFAULT NULL, p_checked_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

-- admin of the proposal's company, never a bot, never a sales login
CREATE OR REPLACE FUNCTION public._bpc_admin_check(p_co uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_accounts_bot(auth.uid()) OR public.is_sales_rep(auth.uid())
     OR NOT public.fl_is_company_admin(auth.uid(), p_co) OR p_co IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Only an admin can review WALDA''s proposals' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._bpc_admin_check(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_pending_proposal_count() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN auth.uid() IS NULL OR public.is_accounts_bot(auth.uid()) OR public.is_sales_rep(auth.uid()) OR NOT public.fl_is_company_admin(auth.uid(), public.caller_company_id()) THEN 0
    ELSE (SELECT count(*)::int FROM public.bot_proposed_changes WHERE company_id=public.caller_company_id() AND status='pending') END;
$$;

-- Approve: runs as the admin (auth.uid() = admin), so every existing RPC re-checks its own rules.
CREATE OR REPLACE FUNCTION public.review_proposed_change(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

REVOKE ALL ON FUNCTION public.walda_invoice_draft_save(uuid,jsonb), public.walda_record_payment(uuid,numeric,text,text,date,uuid),
  public.walda_bank_match(uuid,text,uuid,text), public.walda_sjd_link(uuid,uuid,uuid,uuid), public.walda_sjd_confirm(uuid),
  public.walda_job_unit_save(uuid,uuid,text,text,text,text,text), public.walda_read_accounting(text,timestamptz,int),
  public.propose_change(text,text,jsonb,text,uuid,text,text), public.admin_pending_proposal_count(), public.review_proposed_change(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_invoice_draft_save(uuid,jsonb), public.walda_record_payment(uuid,numeric,text,text,date,uuid),
  public.walda_bank_match(uuid,text,uuid,text), public.walda_sjd_link(uuid,uuid,uuid,uuid), public.walda_sjd_confirm(uuid),
  public.walda_job_unit_save(uuid,uuid,text,text,text,text,text), public.walda_read_accounting(text,timestamptz,int),
  public.propose_change(text,text,jsonb,text,uuid,text,text), public.admin_pending_proposal_count(), public.review_proposed_change(uuid,boolean,text) TO authenticated;

-- ---------- fix found in live tests: invoice send check was NULL-unsafe ----------
-- isa_can_act(uid, co, NULL rep) returned NULL for a non-admin (uid = NULL), and NOT NULL never raised, so anyone signed in
-- (incl. the bot) could send an invoice that had no quote rep. Now NULL means "no", and bots can never send.
CREATE OR REPLACE FUNCTION public.isa_can_act(_uid uuid, _company_id uuid, _rep_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT _uid IS NOT NULL AND NOT public.is_accounts_bot(_uid) AND (
    (_rep_id IS NOT NULL AND _uid = _rep_id)
    OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
                WHERE ur.user_id = _uid AND ur.role = 'admin' AND p.company_id IS NOT DISTINCT FROM _company_id)
  )
$function$;
CREATE OR REPLACE FUNCTION public.isa_assert_can_act(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_company uuid; v_rep uuid;
BEGIN
  SELECT i.company_id, COALESCE(a.rep_id, q.sales_engineer_id) INTO v_company, v_rep
    FROM public.invoices i
    LEFT JOIN public.invoice_send_approvals a ON a.invoice_id = i.id
    LEFT JOIN public.quotes q ON q.id = i.quote_id
   WHERE i.id = p_invoice_id;
  IF NOT FOUND OR NOT COALESCE(public.isa_can_act(auth.uid(), v_company, v_rep), false) THEN
    RAISE EXCEPTION 'Not allowed to send this invoice' USING ERRCODE = '42501';
  END IF;
END $function$;
