-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Removes invoice_house_coverage and restores the first-fit draft functions from
-- 20261116180000_first_fit_house_invoices.sql. Invoice rows and payments stay.

CREATE OR REPLACE FUNCTION public.refresh_house_issue_drafts(p_house uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.project_houses%ROWTYPE;
  q public.quotes%ROWTYPE;
  cfg record;
  v_today date := public._issue_today();
  v_agent uuid;
  v_dep_id uuid;
  v_bal_id uuid;
  v_dep numeric;
  v_bal numeric;
  v_others numeric;
  v_billed numeric;
  v_rate numeric;
  v_sub numeric;
  v_tax numeric;
  v_issued boolean := false;
  v_number text;
  cust record;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  IF h.id IS NULL THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF public._first_fit_staff() THEN
    IF h.company_id IS DISTINCT FROM public.caller_company_id() THEN
      RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
    END IF;
  ELSIF h.company_id IS DISTINCT FROM public._walda_co() THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF NOT h.is_live THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'not live');
  END IF;
  PERFORM public._sync_issue_dates(p_house);
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  SELECT * INTO q
  FROM public.quotes
  WHERE project_house_id = p_house AND origin = 'first_fit' AND archived_at IS NULL
  ORDER BY created_at LIMIT 1;
  IF q.id IS NULL THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'no quote');
  END IF;
  SELECT * INTO cfg FROM public._issue_settings(q.customer_id, h.company_id);
  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  SELECT cm.user_id INTO v_agent
  FROM public.company_members cm
  WHERE cm.company_id = h.company_id AND cm.role = 'admin'
  ORDER BY cm.created_at LIMIT 1;
  IF v_agent IS NULL THEN
    v_agent := COALESCE(q.sales_engineer_id, auth.uid());
  END IF;

  SELECT COALESCE(sum(i.grand_total), 0) INTO v_others
  FROM public.invoices i
  WHERE i.project_house_id = p_house
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
    AND i.archived_at IS NULL
    AND i.issue_stage IS NULL;
  v_dep := round(LEAST(round(COALESCE(q.total, 0) * 0.5, 2), GREATEST(round(COALESCE(q.total, 0) - v_others, 2), 0)), 2);

  SELECT i.id, (coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled') OR i.sent_at IS NOT NULL)
    INTO v_dep_id, v_issued
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'deposit'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;

  PERFORM set_config('app.first_fit_write', '1', true);
  IF v_dep_id IS NULL
     AND h.deposit_due_on IS NOT NULL
     AND v_today >= (h.deposit_due_on - cfg.prepare_days)
     AND v_dep > 0 THEN
    v_rate := COALESCE(q.vat_rate, 0.15);
    IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
    v_tax := round(v_dep * v_rate / (1 + v_rate), 2);
    v_sub := v_dep - v_tax;
    v_number := public.generate_invoice_number();
    INSERT INTO public.invoices (
      quote_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total, issue_date, status, line_items,
      company_id, project_house_id, notes, issue_stage, prep_edited
    ) VALUES (
      q.id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), cust.phone, cust.email, cust.address,
      v_number, v_sub, CASE WHEN v_rate <= 1 THEN v_rate * 100 ELSE v_rate END, v_tax, v_dep, h.deposit_due_on, 'draft',
      jsonb_build_array(jsonb_build_object(
        'description', 'Deposit 50% — house ' || h.house_no || ' — ' || COALESCE(q.quote_number, 'quote'),
        'quantity', 1, 'rate', v_sub, 'amount', v_sub
      )),
      h.company_id, p_house,
      'First fit deposit (50%) for house ' || h.house_no || '. Built from draft quote ' || COALESCE(q.quote_number, '') || ' — review before issuing. Nothing is sent automatically.',
      'deposit', false
    ) RETURNING id INTO v_dep_id;
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
    VALUES (v_dep_id, 'Deposit 50% — house ' || h.house_no, 1, v_sub, v_sub);
  ELSIF v_dep_id IS NOT NULL AND NOT v_issued THEN
    UPDATE public.invoices i
    SET grand_total = v_dep,
        tax_amount = round(v_dep * (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END) / (1 + (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END)), 2),
        subtotal = v_dep - round(v_dep * (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END) / (1 + (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END)), 2),
        issue_date = h.deposit_due_on,
        review_flag = CASE WHEN i.review_flag = 'First fit complete was undone — review before sending' THEN NULL ELSE i.review_flag END,
        notes = 'First fit deposit (50%) for house ' || h.house_no || '. Built from draft quote ' || COALESCE(q.quote_number, '') || ' — review before issuing. Nothing is sent automatically.'
    WHERE i.id = v_dep_id AND i.status = 'draft' AND i.prep_edited IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);
  END IF;

  SELECT (coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled') OR i.sent_at IS NOT NULL)
    INTO v_issued
  FROM public.invoices i WHERE i.id = v_dep_id;
  v_issued := COALESCE(v_issued, false);

  IF v_issued THEN
    PERFORM public._sync_issue_dates(p_house);
    SELECT * INTO h FROM public.project_houses WHERE id = p_house;
    SELECT COALESCE(sum(i.grand_total), 0) INTO v_billed
    FROM public.invoices i
    WHERE i.project_house_id = p_house
      AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
      AND i.archived_at IS NULL
      AND coalesce(i.issue_stage, '') IS DISTINCT FROM 'balance';
    v_bal := round(COALESCE(q.total, 0) - v_billed, 2);
    SELECT i.id INTO v_bal_id
    FROM public.invoices i
    WHERE i.project_house_id = p_house AND i.issue_stage = 'balance'
      AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
    ORDER BY i.created_at LIMIT 1;
    IF v_bal_id IS NULL
       AND h.balance_due_on IS NOT NULL
       AND NOT h.balance_estimated
       AND v_today >= (h.balance_due_on - cfg.prepare_days)
       AND v_bal > 0 THEN
      v_rate := COALESCE(q.vat_rate, 0.15);
      IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
      v_tax := round(v_bal * v_rate / (1 + v_rate), 2);
      v_sub := v_bal - v_tax;
      v_number := public.generate_invoice_number();
      INSERT INTO public.invoices (
        quote_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
        invoice_number, subtotal, tax_rate, tax_amount, grand_total, issue_date, status, line_items,
        company_id, project_house_id, notes, issue_stage, prep_edited, sibling_invoice_id
      ) VALUES (
        q.id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), cust.phone, cust.email, cust.address,
        v_number, v_sub, CASE WHEN v_rate <= 1 THEN v_rate * 100 ELSE v_rate END, v_tax, v_bal, h.balance_due_on, 'draft',
        jsonb_build_array(jsonb_build_object(
          'description', 'Final balance — house ' || h.house_no || ' — ' || COALESCE(q.quote_number, 'quote'),
          'quantity', 1, 'rate', v_sub, 'amount', v_sub
        )),
        h.company_id, p_house,
        'First fit balance for house ' || h.house_no || '. Quote ' || COALESCE(q.quote_number, '') || ' less what is already invoiced on this house. Review before issuing. Nothing is sent automatically.',
        'balance', false, v_dep_id
      ) RETURNING id INTO v_bal_id;
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_bal_id, 'Final balance — house ' || h.house_no, 1, v_sub, v_sub);
    ELSIF v_bal_id IS NOT NULL AND v_bal > 0 THEN
      v_rate := COALESCE(q.vat_rate, 0.15);
      IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
      v_tax := round(v_bal * v_rate / (1 + v_rate), 2);
      v_sub := v_bal - v_tax;
      UPDATE public.invoices i
      SET grand_total = v_bal, tax_amount = v_tax, subtotal = v_sub, issue_date = h.balance_due_on,
          sibling_invoice_id = COALESCE(i.sibling_invoice_id, v_dep_id),
          review_flag = CASE WHEN i.review_flag = 'First fit complete was undone — review before sending' THEN NULL ELSE i.review_flag END
      WHERE i.id = v_bal_id AND i.status = 'draft' AND i.prep_edited IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);
    END IF;
  END IF;

  RETURN jsonb_build_object('result', 'refreshed', 'deposit_id', v_dep_id, 'balance_id', v_bal_id, 'deposit_due_on', h.deposit_due_on, 'balance_due_on', h.balance_due_on, 'balance_estimated', h.balance_estimated);
END $$;
REVOKE ALL ON FUNCTION public.refresh_house_issue_drafts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_house_issue_drafts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._house_fit_row(p_house uuid, p_office boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.project_houses%ROWTYPE;
  pr public.projects%ROWTYPE;
  cfg record;
  q record;
  v_points int;
  v_areas int;
  v_pipe numeric;
  v_by text;
  v_undo text;
  v_dep jsonb;
  v_bal jsonb;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  SELECT * INTO pr FROM public.projects WHERE id = h.project_id;
  SELECT * INTO cfg FROM public._issue_settings(pr.customer_id, h.company_id);
  SELECT count(*) INTO v_points FROM public.first_fit_points WHERE project_house_id = p_house;
  SELECT count(*) INTO v_areas FROM public.project_house_units WHERE project_house_id = p_house;
  SELECT COALESCE(round(sum(pipe_m), 2), 0) INTO v_pipe FROM public.first_fit_points WHERE project_house_id = p_house;
  SELECT full_name INTO v_by FROM public.profiles WHERE id = h.first_fit_complete_by;
  SELECT full_name INTO v_undo FROM public.profiles WHERE id = h.first_fit_undone_by;
  SELECT q.id, q.quote_number, q.review_flag, q.total, q.status INTO q
  FROM public.quotes q
  WHERE q.project_house_id = p_house AND q.origin = 'first_fit' AND q.archived_at IS NULL
  ORDER BY q.created_at LIMIT 1;
  SELECT jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'status', i.status, 'amount', CASE WHEN p_office THEN i.grand_total ELSE NULL END, 'flag', i.review_flag
  ) INTO v_dep
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'deposit'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;
  SELECT jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'status', i.status, 'amount', CASE WHEN p_office THEN i.grand_total ELSE NULL END, 'flag', i.review_flag
  ) INTO v_bal
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'balance'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'house_id', h.id,
    'company_id', h.company_id,
    'house_no', h.house_no,
    'project_id', h.project_id,
    'project_name', pr.name,
    'live', h.is_live,
    'complete_at', h.first_fit_complete_at,
    'complete_by', v_by,
    'undone_at', CASE WHEN h.is_live THEN NULL ELSE h.first_fit_undone_at END,
    'undone_by', CASE WHEN h.is_live THEN NULL ELSE v_undo END,
    'points', v_points,
    'areas', v_areas,
    'pipe_m', v_pipe,
    'deposit_on', h.deposit_due_on,
    'deposit_state', public.issue_schedule_state(h.deposit_due_on, public._issue_today(), cfg.prepare_days, false),
    'balance_on', h.balance_due_on,
    'balance_state', public.issue_schedule_state(h.balance_due_on, public._issue_today(), cfg.prepare_days, h.balance_estimated),
    'balance_estimated', h.balance_estimated,
    'deposit', v_dep,
    'balance', v_bal,
    'quote', CASE WHEN q.id IS NULL THEN NULL
      WHEN p_office THEN jsonb_build_object('id', q.id, 'number', q.quote_number, 'flag', q.review_flag, 'total', q.total, 'status', q.status)
      ELSE jsonb_build_object('ready', true, 'flag', q.review_flag) END,
    'default_unit', 'Samsung AR40H wall unit'
  );
END $$;
REVOKE ALL ON FUNCTION public._house_fit_row(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.walda_first_fit_issue_digest(p_on date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public._walda_co();
  v_today date;
  r record;
  v_rows jsonb := '[]'::jsonb;
  cfg record;
  v_state text;
  v_amount numeric;
BEGIN
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NOT NULL THEN
    PERFORM set_config('app.backfill', '1', true);
    PERFORM set_config('app.today', p_on::text, true);
  END IF;
  v_today := public._issue_today();
  FOR r IN
    SELECT h.id
    FROM public.project_houses h
    WHERE h.company_id = co AND h.is_live
  LOOP
    PERFORM public.refresh_house_issue_drafts(r.id);
  END LOOP;
  FOR r IN
    SELECT h.*, p.name AS project_name, p.customer_id
    FROM public.project_houses h
    JOIN public.projects p ON p.id = h.project_id
    WHERE h.company_id = co AND (h.deposit_due_on IS NOT NULL OR h.balance_due_on IS NOT NULL)
  LOOP
    SELECT * INTO cfg FROM public._issue_settings(r.customer_id, co);
    v_state := public.issue_schedule_state(r.deposit_due_on, v_today, cfg.prepare_days, false);
    IF v_state IN ('due_soon', 'due_today', 'overdue') THEN
      SELECT i.grand_total INTO v_amount
      FROM public.invoices i
      WHERE i.project_house_id = r.id AND i.issue_stage = 'deposit'
        AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
      ORDER BY i.created_at LIMIT 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'kind', 'deposit', 'state', v_state, 'due_on', r.deposit_due_on,
        'house_id', r.id, 'house_no', r.house_no, 'project_id', r.project_id, 'project_name', r.project_name,
        'amount', v_amount, 'estimated', false,
        'link', '/admin/projects/' || r.project_id || '?house=' || r.id
      ));
    END IF;
    v_state := public.issue_schedule_state(r.balance_due_on, v_today, cfg.prepare_days, r.balance_estimated);
    IF v_state IN ('due_soon', 'due_today', 'overdue') THEN
      SELECT i.grand_total INTO v_amount
      FROM public.invoices i
      WHERE i.project_house_id = r.id AND i.issue_stage = 'balance'
        AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
      ORDER BY i.created_at LIMIT 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'kind', 'balance', 'state', v_state, 'due_on', r.balance_due_on,
        'house_id', r.id, 'house_no', r.house_no, 'project_id', r.project_id, 'project_name', r.project_name,
        'amount', v_amount, 'estimated', false,
        'link', '/admin/projects/' || r.project_id || '?house=' || r.id
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('on', v_today, 'rows', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.walda_first_fit_issue_digest(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_first_fit_issue_digest(date) TO authenticated;


DROP FUNCTION IF EXISTS public.invoice_covers(uuid);
DROP FUNCTION IF EXISTS public.record_invoice_coverage(text, numeric, text, uuid, text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.walda_record_invoice_coverage(text, numeric, text, uuid, text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public._record_invoice_coverage(uuid, uuid, text, uuid, uuid, text, text, numeric, text, text);
DROP FUNCTION IF EXISTS public._house_invoice_coverage(uuid);

DROP TRIGGER IF EXISTS trg_invoice_house_coverage_audit ON public.invoice_house_coverage;
DROP TRIGGER IF EXISTS trg_invoice_house_coverage_company ON public.invoice_house_coverage;
DROP FUNCTION IF EXISTS public.trg_invoice_house_coverage_audit();
DROP FUNCTION IF EXISTS public.trg_invoice_house_coverage_company();

DROP TABLE IF EXISTS public.invoice_house_coverage;
DROP TYPE IF EXISTS public.invoice_coverage_scope;
