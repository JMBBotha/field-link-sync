-- Invoice ↔ house coverage. A link says an existing invoice already bills one
-- scope of one house, so First fit complete does not draft that scope again.
-- The invoice row is not changed. Apply the go-live seed separately, on Johan's word.
-- Undo: supabase/manual/20261116213000_invoice_house_coverage_rollback.sql

DO $$
BEGIN
  CREATE TYPE public.invoice_coverage_scope AS ENUM (
    'full_system', 'labour_extraction', 'units', 'deposit', 'balance'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.invoice_house_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  project_house_id uuid NOT NULL REFERENCES public.project_houses(id) ON DELETE CASCADE,
  scope public.invoice_coverage_scope NOT NULL,
  amount_incl numeric(14, 2) NOT NULL CHECK (amount_incl >= 0),
  note text,
  source_ref text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_house_coverage_uniq UNIQUE (invoice_id, project_house_id, scope)
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_house_coverage_source_ref
  ON public.invoice_house_coverage (company_id, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoice_house_coverage_house_idx
  ON public.invoice_house_coverage (project_house_id);

COMMENT ON TABLE public.invoice_house_coverage IS
  'Which existing invoice already covers a house, and for which scope. Does not change the invoice.';

-- Company is taken from the invoice. The house must be in that same company.
CREATE OR REPLACE FUNCTION public.trg_invoice_house_coverage_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_inv uuid;
  v_house uuid;
BEGIN
  SELECT i.company_id INTO v_inv FROM public.invoices i WHERE i.id = NEW.invoice_id;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
  END IF;
  SELECT h.company_id INTO v_house FROM public.project_houses h WHERE h.id = NEW.project_house_id;
  IF v_house IS NULL THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF v_inv IS DISTINCT FROM v_house THEN
    RAISE EXCEPTION 'That house is not in this invoice''s company' USING ERRCODE = '22023';
  END IF;
  NEW.company_id := v_inv;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_house_coverage_company ON public.invoice_house_coverage;
CREATE TRIGGER trg_invoice_house_coverage_company
  BEFORE INSERT OR UPDATE OF invoice_id, project_house_id ON public.invoice_house_coverage
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_house_coverage_company();

-- Every insert, update, and delete is written to bot_audit_log. A migration has no login,
-- so the actor is a fixed id and the action name ends in _seed.
CREATE OR REPLACE FUNCTION public.trg_invoice_house_coverage_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_action text;
  v_row public.invoice_house_coverage;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_action := 'invoice_coverage_deleted';
    v_row := OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'invoice_coverage_updated';
    v_row := NEW;
  ELSE
    v_action := 'invoice_coverage_inserted';
    v_row := NEW;
  END IF;
  IF v_actor IS NULL THEN
    v_actor := '00000000-0000-4000-8000-0000000000c0';
    v_action := v_action || '_seed';
  END IF;
  INSERT INTO public.bot_audit_log (company_id, actor_id, action, target_table, target_id, before, after)
  VALUES (
    v_row.company_id,
    v_actor,
    v_action,
    'invoice_house_coverage',
    v_row.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_invoice_house_coverage_audit ON public.invoice_house_coverage;
CREATE TRIGGER trg_invoice_house_coverage_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_house_coverage
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_house_coverage_audit();

ALTER TABLE public.invoice_house_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_house_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_house_coverage TO authenticated;

DROP POLICY IF EXISTS invoice_house_coverage_admin ON public.invoice_house_coverage;
CREATE POLICY invoice_house_coverage_admin ON public.invoice_house_coverage
  FOR ALL TO authenticated
  USING (public.fl_is_company_admin(auth.uid(), company_id))
  WITH CHECK (public.fl_is_company_admin(auth.uid(), company_id));

DO $$
BEGIN
  IF to_regprocedure('public.is_accounts_bot()') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS zz_no_accounts_bot ON public.invoice_house_coverage';
  EXECUTE $p$CREATE POLICY zz_no_accounts_bot ON public.invoice_house_coverage
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT public.is_accounts_bot()))
    WITH CHECK (NOT (SELECT public.is_accounts_bot()))$p$;
END $$;

-- Facts the engine and the house page read. Live (not void, not archived) links only.
CREATE OR REPLACE FUNCTION public._house_invoice_coverage(p_house uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q public.quotes%ROWTYPE;
  v_full boolean := false;
  v_labour boolean := false;
  v_units boolean := false;
  v_deposit boolean := false;
  v_balance boolean := false;
  v_full_no text;
  v_labour_no text;
  v_units_no text;
  v_deposit_no text;
  v_balance_no text;
  v_rows jsonb := '[]'::jsonb;
  v_already text;
  v_bill_units boolean := false;
  v_ex numeric := 0;
  v_needed boolean := true;
  v_n int := 0;
  v_pct numeric := 0;
  v_rate numeric := 0.15;
  v_incl numeric := 0;
BEGIN
  SELECT
    COALESCE(bool_or(c.scope = 'full_system'), false),
    COALESCE(bool_or(c.scope = 'labour_extraction'), false),
    COALESCE(bool_or(c.scope = 'units'), false),
    COALESCE(bool_or(c.scope = 'deposit'), false),
    COALESCE(bool_or(c.scope = 'balance'), false)
  INTO v_full, v_labour, v_units, v_deposit, v_balance
  FROM public.invoice_house_coverage c
  JOIN public.invoices i ON i.id = c.invoice_id
  WHERE c.project_house_id = p_house
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
    AND i.archived_at IS NULL;

  SELECT string_agg(DISTINCT i.invoice_number, ', ' ORDER BY i.invoice_number) FILTER (WHERE c.scope = 'full_system'),
         string_agg(DISTINCT i.invoice_number, ', ' ORDER BY i.invoice_number) FILTER (WHERE c.scope = 'labour_extraction'),
         string_agg(DISTINCT i.invoice_number, ', ' ORDER BY i.invoice_number) FILTER (WHERE c.scope = 'units'),
         string_agg(DISTINCT i.invoice_number, ', ' ORDER BY i.invoice_number) FILTER (WHERE c.scope = 'deposit'),
         string_agg(DISTINCT i.invoice_number, ', ' ORDER BY i.invoice_number) FILTER (WHERE c.scope = 'balance'),
         COALESCE(jsonb_agg(jsonb_build_object(
           'invoice_id', i.id,
           'invoice_number', i.invoice_number,
           'scope', c.scope,
           'amount_incl', c.amount_incl,
           'note', c.note,
           'house_no', h.house_no
         ) ORDER BY i.invoice_number, c.scope), '[]'::jsonb)
    INTO v_full_no, v_labour_no, v_units_no, v_deposit_no, v_balance_no, v_rows
  FROM public.invoice_house_coverage c
  JOIN public.invoices i ON i.id = c.invoice_id
  JOIN public.project_houses h ON h.id = c.project_house_id
  WHERE c.project_house_id = p_house
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
    AND i.archived_at IS NULL;

  IF v_full THEN
    v_already := v_full_no;
  ELSIF v_labour AND v_units THEN
    v_already := concat_ws(', ', v_labour_no, v_units_no);
  ELSIF v_deposit AND v_balance THEN
    v_already := concat_ws(', ', v_deposit_no, v_balance_no);
  END IF;

  v_bill_units := v_labour AND NOT v_units AND NOT v_full AND v_already IS NULL;

  SELECT * INTO q
  FROM public.quotes
  WHERE project_house_id = p_house AND origin = 'first_fit' AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1;
  IF NOT FOUND THEN
    q := NULL;
  END IF;

  IF q.id IS NOT NULL THEN
    SELECT count(*) INTO v_n
    FROM public.quote_items qi
    WHERE qi.quote_id = q.id AND COALESCE(qi.metadata->>'quote_category', '') = 'units';
    IF v_n > 0 THEN
      SELECT COALESCE(bool_or(
               COALESCE((qi.metadata->>'price_needed')::boolean, false)
               OR COALESCE(qi.unit_price, 0) = 0
             ), true),
             COALESCE(sum(qi.total_price), 0)
        INTO v_needed, v_ex
      FROM public.quote_items qi
      WHERE qi.quote_id = q.id AND COALESCE(qi.metadata->>'quote_category', '') = 'units';
    END IF;
    v_pct := CASE WHEN q.discount_type = 'percent' THEN COALESCE(q.discount_value, 0) ELSE 0 END;
    v_rate := COALESCE(q.vat_rate, 0.15);
    IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
  END IF;

  IF NOT v_needed THEN
    v_incl := round((v_ex - (v_ex * v_pct / 100.0)) * (1 + v_rate), 2);
  END IF;

  RETURN jsonb_build_object(
    'full_system', v_full,
    'labour', v_labour,
    'units', v_units,
    'deposit', v_deposit,
    'balance', v_balance,
    'full_invoice', v_full_no,
    'labour_invoice', v_labour_no,
    'already_invoiced_on', v_already,
    'bill_units_only', v_bill_units,
    'units_price_needed', v_bill_units AND v_needed,
    'units_invoice_needed', v_bill_units AND v_needed,
    'units_incl', CASE WHEN v_needed THEN NULL ELSE v_incl END,
    'rows', v_rows
  );
END $$;
REVOKE ALL ON FUNCTION public._house_invoice_coverage(uuid) FROM PUBLIC, anon, authenticated;

-- Shared write. One source reference is one row. The same invoice, house, and scope
-- is never inserted twice. Invoice rows are not updated.
CREATE OR REPLACE FUNCTION public._record_invoice_coverage(
  p_co uuid,
  p_invoice uuid,
  p_invoice_number text,
  p_house uuid,
  p_project uuid,
  p_house_no text,
  p_scope text,
  p_amount numeric,
  p_note text,
  p_source_ref text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope public.invoice_coverage_scope;
  v_amt numeric;
  v_note text;
  v_ref text;
  v_inv uuid;
  v_house uuid;
  v_no text;
  v_n int;
  v_old public.invoice_house_coverage%ROWTYPE;
  v_new public.invoice_house_coverage%ROWTYPE;
  i int;
BEGIN
  IF p_co IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('full_system', 'labour_extraction', 'units', 'deposit', 'balance') THEN
    RAISE EXCEPTION 'Scope must be full_system, labour_extraction, units, deposit or balance' USING ERRCODE = '22023';
  END IF;
  v_scope := p_scope::public.invoice_coverage_scope;
  IF p_amount IS NULL OR p_amount = 'NaN'::numeric OR p_amount < 0 THEN
    RAISE EXCEPTION 'Amount including VAT is required' USING ERRCODE = '22023';
  END IF;
  v_amt := round(p_amount, 2);
  v_note := nullif(btrim(p_note), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023';
  END IF;
  v_ref := nullif(btrim(p_source_ref), '');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Source reference is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_ref) > 120 THEN
    RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023';
  END IF;

  IF p_invoice IS NOT NULL THEN
    SELECT i.id INTO v_inv FROM public.invoices i WHERE i.id = p_invoice AND i.company_id = p_co;
    IF v_inv IS NULL THEN
      RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_no := nullif(btrim(p_invoice_number), '');
    IF v_no IS NULL THEN
      RAISE EXCEPTION 'Give the invoice id or the invoice number' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_n FROM public.invoices i
    WHERE i.company_id = p_co AND i.invoice_number = v_no;
    IF v_n = 1 THEN
      SELECT i.id INTO v_inv FROM public.invoices i
      WHERE i.company_id = p_co AND i.invoice_number = v_no;
    ELSIF v_n > 1 THEN
      RAISE EXCEPTION 'More than one invoice matches that number' USING ERRCODE = '22023';
    ELSE
      -- Same digits, leading zeros ignored, and only for a real invoice number (5 digits or more).
      -- Shorter digit strings would collide with INV-001 and LAB-1.
      IF length(ltrim(regexp_replace(v_no, '\D', '', 'g'), '0')) < 5 THEN
        RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
      END IF;
      SELECT count(*) INTO v_n FROM public.invoices i
      WHERE i.company_id = p_co
        AND ltrim(regexp_replace(i.invoice_number, '\D', '', 'g'), '0') = ltrim(regexp_replace(v_no, '\D', '', 'g'), '0');
      IF v_n = 0 THEN
        RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
      END IF;
      IF v_n > 1 THEN
        RAISE EXCEPTION 'More than one invoice matches that number' USING ERRCODE = '22023';
      END IF;
      SELECT i.id INTO v_inv FROM public.invoices i
      WHERE i.company_id = p_co
        AND ltrim(regexp_replace(i.invoice_number, '\D', '', 'g'), '0') = ltrim(regexp_replace(v_no, '\D', '', 'g'), '0');
    END IF;
  END IF;

  v_no := nullif(btrim(p_house_no), '');
  IF v_no IS NOT NULL THEN
    v_no := nullif(btrim(regexp_replace(v_no, '^(erf|house)\s*', '', 'i')), '');
  END IF;
  v_house := public._resolve_project_house(p_co, p_house, p_project, v_no);
  IF (SELECT h.company_id FROM public.project_houses h WHERE h.id = v_house)
     IS DISTINCT FROM (SELECT i.company_id FROM public.invoices i WHERE i.id = v_inv) THEN
    RAISE EXCEPTION 'That house is not in this invoice''s company' USING ERRCODE = '22023';
  END IF;

  FOR i IN 1..2 LOOP
    SELECT * INTO v_old
    FROM public.invoice_house_coverage
    WHERE company_id = p_co AND source_ref = v_ref
    FOR UPDATE;
    IF FOUND THEN
      IF v_old.invoice_id = v_inv
         AND v_old.project_house_id = v_house
         AND v_old.scope = v_scope
         AND v_old.amount_incl = v_amt
         AND v_old.note IS NOT DISTINCT FROM v_note THEN
        PERFORM public._bot_audit(p_co, 'invoice_coverage_skipped', 'invoice_house_coverage', v_old.id, to_jsonb(v_old), to_jsonb(v_old));
        RETURN jsonb_build_object(
          'result', 'skipped', 'id', v_old.id, 'invoice_id', v_old.invoice_id,
          'house_id', v_old.project_house_id, 'scope', v_old.scope, 'amount_incl', v_old.amount_incl
        );
      END IF;
      BEGIN
        UPDATE public.invoice_house_coverage
        SET invoice_id = v_inv,
            project_house_id = v_house,
            scope = v_scope,
            amount_incl = v_amt,
            note = v_note
        WHERE id = v_old.id
        RETURNING * INTO v_new;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'That house is already covered on this invoice for that scope' USING ERRCODE = '23505';
      END;
      RETURN jsonb_build_object(
        'result', 'updated', 'id', v_new.id, 'invoice_id', v_new.invoice_id,
        'house_id', v_new.project_house_id, 'scope', v_new.scope, 'amount_incl', v_new.amount_incl
      );
    END IF;

    SELECT * INTO v_old
    FROM public.invoice_house_coverage
    WHERE invoice_id = v_inv AND project_house_id = v_house AND scope = v_scope
    FOR UPDATE;
    IF FOUND THEN
      IF v_old.amount_incl = v_amt AND v_old.note IS NOT DISTINCT FROM v_note THEN
        PERFORM public._bot_audit(p_co, 'invoice_coverage_skipped', 'invoice_house_coverage', v_old.id, to_jsonb(v_old), to_jsonb(v_old));
        RETURN jsonb_build_object(
          'result', 'skipped', 'id', v_old.id, 'invoice_id', v_old.invoice_id,
          'house_id', v_old.project_house_id, 'scope', v_old.scope, 'amount_incl', v_old.amount_incl
        );
      END IF;
      RAISE EXCEPTION 'That house is already covered on this invoice for that scope' USING ERRCODE = '23505';
    END IF;

    BEGIN
      INSERT INTO public.invoice_house_coverage (
        invoice_id, project_house_id, scope, amount_incl, note, source_ref, created_by
      ) VALUES (
        v_inv, v_house, v_scope, v_amt, v_note, v_ref, auth.uid()
      ) RETURNING * INTO v_new;
      RETURN jsonb_build_object(
        'result', 'inserted', 'id', v_new.id, 'invoice_id', v_new.invoice_id,
        'house_id', v_new.project_house_id, 'scope', v_new.scope, 'amount_incl', v_new.amount_incl
      );
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN
        RAISE EXCEPTION 'That house is already covered on this invoice for that scope' USING ERRCODE = '23505';
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the coverage';
END $$;
REVOKE ALL ON FUNCTION public._record_invoice_coverage(uuid, uuid, text, uuid, uuid, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.walda_record_invoice_coverage(
  p_scope text,
  p_amount numeric,
  p_source_ref text,
  p_invoice uuid DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_house uuid DEFAULT NULL,
  p_project uuid DEFAULT NULL,
  p_house_no text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public._walda_co();
BEGIN
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  RETURN public._record_invoice_coverage(
    co, p_invoice, p_invoice_number, p_house, p_project, p_house_no, p_scope, p_amount, p_note, p_source_ref
  );
END $$;
REVOKE ALL ON FUNCTION public.walda_record_invoice_coverage(text, numeric, text, uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_invoice_coverage(text, numeric, text, uuid, text, uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_coverage(
  p_scope text,
  p_amount numeric,
  p_source_ref text,
  p_invoice uuid DEFAULT NULL,
  p_invoice_number text DEFAULT NULL,
  p_house uuid DEFAULT NULL,
  p_project uuid DEFAULT NULL,
  p_house_no text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
BEGIN
  IF NOT public.fl_is_company_admin(auth.uid(), co) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  RETURN public._record_invoice_coverage(
    co, p_invoice, p_invoice_number, p_house, p_project, p_house_no, p_scope, p_amount, p_note, p_source_ref
  );
END $$;
REVOKE ALL ON FUNCTION public.record_invoice_coverage(text, numeric, text, uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_coverage(text, numeric, text, uuid, text, uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_covers(p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv public.invoices%ROWTYPE;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.caller_company_id() IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice;
  IF inv.id IS NULL OR inv.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.fl_is_company_admin(auth.uid(), inv.company_id)
     AND NOT public._first_fit_office() THEN
    RETURN jsonb_build_object('houses', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'house_no', h.house_no,
    'house_id', h.id,
    'project_id', h.project_id,
    'scope', c.scope,
    'amount_incl', c.amount_incl,
    'note', c.note,
    'invoice_number', inv.invoice_number
  ) ORDER BY length(h.house_no), h.house_no, c.scope), '[]'::jsonb)
  INTO v_rows
  FROM public.invoice_house_coverage c
  JOIN public.project_houses h ON h.id = c.project_house_id
  WHERE c.invoice_id = p_invoice;
  RETURN jsonb_build_object('houses', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.invoice_covers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_covers(uuid) TO authenticated;

-- Drafts check coverage before they insert. A covered scope is not drafted again.
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
  v_cov jsonb;
  v_base numeric;
  v_units_only boolean := false;
  v_dep_label text;
  v_dep_notes text;
  v_bal_label text;
  v_bal_notes text;
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

  v_cov := public._house_invoice_coverage(p_house);
  IF v_cov->>'already_invoiced_on' IS NOT NULL THEN
    UPDATE public.project_houses
    SET deposit_due_on = NULL, balance_due_on = NULL, balance_estimated = false
    WHERE id = p_house;
    RETURN jsonb_build_object(
      'result', 'covered',
      'reason', 'Already invoiced on ' || (v_cov->>'already_invoiced_on'),
      'already_invoiced_on', v_cov->>'already_invoiced_on',
      'deposit_id', NULL,
      'balance_id', NULL
    );
  END IF;

  PERFORM public._sync_issue_dates(p_house);
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  SELECT * INTO q
  FROM public.quotes
  WHERE project_house_id = p_house AND origin = 'first_fit' AND archived_at IS NULL
  ORDER BY created_at LIMIT 1;

  IF COALESCE(v_cov->>'units_invoice_needed', '') = 'true'
     OR (COALESCE(v_cov->>'units', '') = 'true' AND v_cov->>'units_incl' IS NULL AND v_cov->>'already_invoiced_on' IS NULL) THEN
    RETURN jsonb_build_object(
      'result', 'units_needed',
      'reason', 'units invoice needed',
      'units_invoice_needed', true,
      'labour_invoice', v_cov->>'labour_invoice',
      'deposit_id', NULL,
      'balance_id', NULL,
      'deposit_due_on', h.deposit_due_on,
      'balance_due_on', h.balance_due_on,
      'balance_estimated', h.balance_estimated
    );
  END IF;

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

  v_units_only := COALESCE(v_cov->>'bill_units_only', '') = 'true';
  v_base := CASE
    WHEN v_units_only THEN COALESCE((v_cov->>'units_incl')::numeric, 0)
    WHEN COALESCE(v_cov->>'units', '') = 'true' AND v_cov->>'units_incl' IS NOT NULL
      THEN GREATEST(round(COALESCE(q.total, 0) - (v_cov->>'units_incl')::numeric, 2), 0)
    ELSE COALESCE(q.total, 0)
  END;

  SELECT COALESCE(sum(i.grand_total), 0) INTO v_others
  FROM public.invoices i
  WHERE i.project_house_id = p_house
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
    AND i.archived_at IS NULL
    AND i.issue_stage IS NULL;
  v_dep := round(LEAST(round(v_base * 0.5, 2), GREATEST(round(v_base - v_others, 2), 0)), 2);

  SELECT i.id, (coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled') OR i.sent_at IS NOT NULL)
    INTO v_dep_id, v_issued
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'deposit'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;

  v_dep_label := CASE
    WHEN v_units_only THEN 'Units deposit 50% — house ' || h.house_no
    ELSE 'Deposit 50% — house ' || h.house_no || ' — ' || COALESCE(q.quote_number, 'quote')
  END;
  v_dep_notes := CASE
    WHEN v_units_only THEN 'Units only for house ' || h.house_no || '. Labour was already invoiced on ' || COALESCE(v_cov->>'labour_invoice', '') || '. Review before issuing. Nothing is sent automatically.'
    ELSE 'First fit deposit (50%) for house ' || h.house_no || '. Built from draft quote ' || COALESCE(q.quote_number, '') || ' — review before issuing. Nothing is sent automatically.'
  END;

  PERFORM set_config('app.first_fit_write', '1', true);
  IF COALESCE(v_cov->>'deposit', '') = 'true' THEN
    NULL;
  ELSIF v_dep_id IS NULL
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
        'description', v_dep_label,
        'quantity', 1, 'rate', v_sub, 'amount', v_sub
      )),
      h.company_id, p_house,
      v_dep_notes,
      'deposit', false
    ) RETURNING id INTO v_dep_id;
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
    VALUES (v_dep_id, v_dep_label, 1, v_sub, v_sub);
  ELSIF v_dep_id IS NOT NULL AND NOT v_issued THEN
    UPDATE public.invoices i
    SET grand_total = v_dep,
        tax_amount = round(v_dep * (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END) / (1 + (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END)), 2),
        subtotal = v_dep - round(v_dep * (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END) / (1 + (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END)), 2),
        issue_date = h.deposit_due_on,
        review_flag = CASE WHEN i.review_flag = 'First fit complete was undone — review before sending' THEN NULL ELSE i.review_flag END,
        notes = v_dep_notes
    WHERE i.id = v_dep_id AND i.status = 'draft' AND i.prep_edited IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);
  END IF;

  SELECT (coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled') OR i.sent_at IS NOT NULL)
    INTO v_issued
  FROM public.invoices i WHERE i.id = v_dep_id;
  v_issued := COALESCE(v_issued, false);

  IF v_issued AND COALESCE(v_cov->>'balance', '') IS DISTINCT FROM 'true' THEN
    PERFORM public._sync_issue_dates(p_house);
    SELECT * INTO h FROM public.project_houses WHERE id = p_house;
    SELECT COALESCE(sum(i.grand_total), 0) INTO v_billed
    FROM public.invoices i
    WHERE i.project_house_id = p_house
      AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
      AND i.archived_at IS NULL
      AND coalesce(i.issue_stage, '') IS DISTINCT FROM 'balance';
    v_bal := round(v_base - v_billed, 2);
    SELECT i.id INTO v_bal_id
    FROM public.invoices i
    WHERE i.project_house_id = p_house AND i.issue_stage = 'balance'
      AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
    ORDER BY i.created_at LIMIT 1;
    v_bal_label := CASE
      WHEN v_units_only THEN 'Units balance — house ' || h.house_no
      ELSE 'Final balance — house ' || h.house_no || ' — ' || COALESCE(q.quote_number, 'quote')
    END;
    v_bal_notes := CASE
      WHEN v_units_only THEN 'Units balance for house ' || h.house_no || '. Labour was already invoiced on ' || COALESCE(v_cov->>'labour_invoice', '') || '. Review before issuing. Nothing is sent automatically.'
      ELSE 'First fit balance for house ' || h.house_no || '. Quote ' || COALESCE(q.quote_number, '') || ' less what is already invoiced on this house. Review before issuing. Nothing is sent automatically.'
    END;
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
          'description', v_bal_label,
          'quantity', 1, 'rate', v_sub, 'amount', v_sub
        )),
        h.company_id, p_house,
        v_bal_notes,
        'balance', false, v_dep_id
      ) RETURNING id INTO v_bal_id;
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_bal_id, v_bal_label, 1, v_sub, v_sub);
    ELSIF v_bal_id IS NOT NULL AND v_bal > 0 THEN
      v_rate := COALESCE(q.vat_rate, 0.15);
      IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
      v_tax := round(v_bal * v_rate / (1 + v_rate), 2);
      v_sub := v_bal - v_tax;
      UPDATE public.invoices i
      SET grand_total = v_bal, tax_amount = v_tax, subtotal = v_sub, issue_date = h.balance_due_on,
          sibling_invoice_id = COALESCE(i.sibling_invoice_id, v_dep_id),
          review_flag = CASE WHEN i.review_flag = 'First fit complete was undone — review before sending' THEN NULL ELSE i.review_flag END,
          notes = v_bal_notes
      WHERE i.id = v_bal_id AND i.status = 'draft' AND i.prep_edited IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'result', 'refreshed',
    'deposit_id', v_dep_id,
    'balance_id', v_bal_id,
    'deposit_due_on', h.deposit_due_on,
    'balance_due_on', h.balance_due_on,
    'balance_estimated', h.balance_estimated,
    'bill_units_only', v_units_only,
    'labour_invoice', v_cov->>'labour_invoice'
  );
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
  v_qid uuid;
  v_qnum text;
  v_qflag text;
  v_qtotal numeric;
  v_qstatus text;
  v_points int;
  v_areas int;
  v_pipe numeric;
  v_by text;
  v_undo text;
  v_dep jsonb;
  v_bal jsonb;
  v_cov jsonb;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  SELECT * INTO pr FROM public.projects WHERE id = h.project_id;
  SELECT * INTO cfg FROM public._issue_settings(pr.customer_id, h.company_id);
  SELECT count(*) INTO v_points FROM public.first_fit_points WHERE project_house_id = p_house;
  SELECT count(*) INTO v_areas FROM public.project_house_units WHERE project_house_id = p_house;
  SELECT COALESCE(round(sum(pipe_m), 2), 0) INTO v_pipe FROM public.first_fit_points WHERE project_house_id = p_house;
  SELECT full_name INTO v_by FROM public.profiles WHERE id = h.first_fit_complete_by;
  SELECT full_name INTO v_undo FROM public.profiles WHERE id = h.first_fit_undone_by;
  SELECT src.id, src.quote_number, src.review_flag, src.total, src.status
    INTO v_qid, v_qnum, v_qflag, v_qtotal, v_qstatus
  FROM public.quotes src
  WHERE src.project_house_id = p_house AND src.origin = 'first_fit' AND src.archived_at IS NULL
  ORDER BY src.created_at LIMIT 1;
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
  v_cov := public._house_invoice_coverage(p_house);
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
    'deposit_on', CASE WHEN v_cov->>'already_invoiced_on' IS NOT NULL OR COALESCE(v_cov->>'units_invoice_needed', '') = 'true' THEN NULL ELSE h.deposit_due_on END,
    'deposit_state', CASE WHEN v_cov->>'already_invoiced_on' IS NOT NULL OR COALESCE(v_cov->>'units_invoice_needed', '') = 'true' THEN NULL ELSE public.issue_schedule_state(h.deposit_due_on, public._issue_today(), cfg.prepare_days, false) END,
    'balance_on', CASE WHEN v_cov->>'already_invoiced_on' IS NOT NULL OR COALESCE(v_cov->>'units_invoice_needed', '') = 'true' THEN NULL ELSE h.balance_due_on END,
    'balance_state', CASE WHEN v_cov->>'already_invoiced_on' IS NOT NULL OR COALESCE(v_cov->>'units_invoice_needed', '') = 'true' THEN NULL ELSE public.issue_schedule_state(h.balance_due_on, public._issue_today(), cfg.prepare_days, h.balance_estimated) END,
    'balance_estimated', h.balance_estimated,
    'deposit', v_dep,
    'balance', v_bal,
    'quote', CASE WHEN v_qid IS NULL THEN NULL
      WHEN p_office THEN jsonb_build_object('id', v_qid, 'number', v_qnum, 'flag', v_qflag, 'total', v_qtotal, 'status', v_qstatus)
      ELSE jsonb_build_object('ready', true, 'flag', v_qflag) END,
    'default_unit', 'Samsung AR40H wall unit',
    'already_invoiced_on', v_cov->>'already_invoiced_on',
    'labour_invoice', v_cov->>'labour_invoice',
    'units_invoice_needed', COALESCE((v_cov->>'units_invoice_needed')::boolean, false),
    'coverage', v_cov->'rows'
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
  v_cov jsonb;
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
    v_cov := public._house_invoice_coverage(r.id);
    IF v_cov->>'already_invoiced_on' IS NOT NULL THEN
      CONTINUE;
    END IF;
    SELECT * INTO cfg FROM public._issue_settings(r.customer_id, co);
    IF COALESCE(v_cov->>'units_invoice_needed', '') = 'true' THEN
      v_state := public.issue_schedule_state(r.deposit_due_on, v_today, cfg.prepare_days, false);
      IF v_state IN ('due_soon', 'due_today', 'overdue') THEN
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'kind', 'units', 'state', v_state, 'due_on', r.deposit_due_on,
          'house_id', r.id, 'house_no', r.house_no, 'project_id', r.project_id, 'project_name', r.project_name,
          'amount', NULL, 'estimated', false, 'flag', 'units invoice needed',
          'link', '/admin/projects/' || r.project_id || '?house=' || r.id
        ));
      END IF;
      CONTINUE;
    END IF;
    v_state := public.issue_schedule_state(r.deposit_due_on, v_today, cfg.prepare_days, false);
    IF v_state IN ('due_soon', 'due_today', 'overdue') AND COALESCE(v_cov->>'deposit', '') IS DISTINCT FROM 'true' THEN
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
    IF v_state IN ('due_soon', 'due_today', 'overdue') AND COALESCE(v_cov->>'balance', '') IS DISTINCT FROM 'true' THEN
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
