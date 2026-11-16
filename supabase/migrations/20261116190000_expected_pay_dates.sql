-- Expected payment dates. Preview only: do not apply this to the live database from the pull request.
-- Adds settings, project rules and per-invoice dates. It does not update invoices or payments.
-- Stellenbosch Village and AVEC are not seeded here. That seed is manual and stays unapplied.

CREATE OR REPLACE FUNCTION public._pay_expect_day_text(p date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT extract(day FROM p)::int::text || ' ' ||
    (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'])[extract(month FROM p)::int];
$fn$;

CREATE OR REPLACE FUNCTION public._pay_expect_names_house(p_text text, p_house text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_text IS NOT NULL AND nullif(btrim(p_house), '') IS NOT NULL
    AND lower(p_text) ~ (
      '(^|[^a-z0-9])house[[:space:]]*(no\.?[[:space:]]*|#[[:space:]]*)?'
      || regexp_replace(lower(btrim(p_house)), '([^a-z0-9])', '\\\1', 'g')
      || '([^a-z0-9]|$)'
    );
$fn$;

-- Days after the invoice, a fixed day of a month, or the last day of a month.
-- Offset 0 is the invoice's own month. Offset 1 is the next month. A short month clamps.
CREATE OR REPLACE FUNCTION public._pay_expect_on(p_invoice date, p_mode text, p_days int, p_day int, p_offset int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_base date;
  v_last date;
  v_off int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF p_invoice IS NULL THEN RETURN NULL; END IF;
  IF p_mode IS NULL OR p_mode = 'days_after' THEN
    RETURN p_invoice + coalesce(p_days, 0);
  END IF;
  v_base := (date_trunc('month', p_invoice::timestamp) + make_interval(months => v_off))::date;
  v_last := (v_base + interval '1 month' - interval '1 day')::date;
  IF p_mode = 'month_end' THEN RETURN v_last; END IF;
  RETURN least(v_base + (least(greatest(coalesce(p_day, 1), 1), 31) - 1), v_last);
END
$fn$;

CREATE OR REPLACE FUNCTION public._pay_expect_deposit_pct(p jsonb, p_fallback numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE n int; i int; s numeric := 0; first numeric; pct numeric;
BEGIN
  IF p IS NOT NULL AND jsonb_typeof(p->'stages') = 'array' THEN
    n := jsonb_array_length(p->'stages');
    IF n BETWEEN 2 AND 4 THEN
      FOR i IN 0..n - 1 LOOP
        pct := (p->'stages'->i->>'pct')::numeric;
        IF pct IS NULL OR pct <= 0 OR pct >= 100 THEN n := 0; EXIT; END IF;
        IF i = 0 THEN first := pct; END IF;
        s := s + pct;
      END LOOP;
      IF n BETWEEN 2 AND 4 AND abs(s - 100) < 0.0000001 THEN RETURN first; END IF;
    END IF;
  END IF;
  IF p_fallback IS NOT NULL AND p_fallback > 0 AND p_fallback < 100 THEN RETURN p_fallback; END IF;
  RETURN 70;
END
$fn$;

-- A job's developer project: the invoice's house, else a house named in the job title
-- (the description only when the title names no house).
CREATE OR REPLACE FUNCTION public._pay_expect_project_for(
  p_company uuid, p_house uuid, p_invoice uuid, p_quote uuid, p_lead uuid, p_customer uuid
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE j record; v_title uuid; v_desc uuid; v uuid;
BEGIN
  IF p_house IS NOT NULL THEN
    SELECT h.project_id INTO v FROM public.project_houses h
    WHERE h.id = p_house AND h.company_id = p_company;
    IF v IS NOT NULL THEN RETURN v; END IF;
  END IF;
  IF to_regclass('public.jobs') IS NULL THEN RETURN NULL; END IF;
  FOR j IN
    SELECT customer_id, title, description FROM public.jobs
    WHERE company_id = p_company AND (
      (p_invoice IS NOT NULL AND invoice_id = p_invoice)
      OR (p_quote IS NOT NULL AND quote_id = p_quote)
      OR (p_lead IS NOT NULL AND lead_id = p_lead)
    )
  LOOP
    SELECT h.project_id INTO v_title
    FROM public.project_houses h
    JOIN public.projects p ON p.id = h.project_id
    WHERE p.company_id = p_company
      AND p.customer_id IS NOT DISTINCT FROM coalesce(j.customer_id, p_customer)
      AND public._pay_expect_names_house(j.title, h.house_no)
    LIMIT 1;
    IF v_title IS NOT NULL THEN RETURN v_title; END IF;
    SELECT h.project_id INTO v_desc
    FROM public.project_houses h
    JOIN public.projects p ON p.id = h.project_id
    WHERE p.company_id = p_company
      AND p.customer_id IS NOT DISTINCT FROM coalesce(j.customer_id, p_customer)
      AND public._pay_expect_names_house(j.description, h.house_no)
    LIMIT 1;
    IF v_desc IS NOT NULL THEN RETURN v_desc; END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;

-- Same gate as company settings. An invited client email is not a company admin, so it is refused.
CREATE OR REPLACE FUNCTION public._pay_expect_admin(p_company uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_accounts_bot(auth.uid())
     OR public.is_sales_rep(auth.uid())
     OR public.is_field_tech_only(auth.uid())
     OR NOT public.can_update_company(auth.uid(), p_company) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
END
$fn$;

CREATE TABLE IF NOT EXISTS public.pay_expect_defaults (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  project_deposit_days integer NOT NULL DEFAULT 15 CHECK (project_deposit_days BETWEEN 0 AND 365),
  project_final_days integer NOT NULL DEFAULT 15 CHECK (project_final_days BETWEEN 0 AND 365),
  window_extra_days integer NOT NULL DEFAULT 5 CHECK (window_extra_days BETWEEN 0 AND 90),
  normal_deposit_days integer NOT NULL DEFAULT 3 CHECK (normal_deposit_days BETWEEN 0 AND 365),
  normal_final_days integer NOT NULL DEFAULT 7 CHECK (normal_final_days BETWEEN 0 AND 365),
  late_grace_days integer NOT NULL DEFAULT 3 CHECK (late_grace_days BETWEEN 0 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.pay_expect_project (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  timing text CHECK (timing IS NULL OR timing IN ('project', 'normal')),
  date_mode text CHECK (date_mode IS NULL OR date_mode IN ('days_after', 'day_of_month', 'month_end')),
  deposit_days integer CHECK (deposit_days IS NULL OR deposit_days BETWEEN 0 AND 365),
  final_days integer CHECK (final_days IS NULL OR final_days BETWEEN 0 AND 365),
  window_extra_days integer CHECK (window_extra_days IS NULL OR window_extra_days BETWEEN 0 AND 90),
  day_of_month integer CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  month_offset integer CHECK (month_offset IS NULL OR month_offset BETWEEN 0 AND 24),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS pay_expect_project_company_idx ON public.pay_expect_project (company_id);

CREATE TABLE IF NOT EXISTS public.pay_expect_invoice (
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  part text NOT NULL CHECK (part IN ('deposit', 'final')),
  company_id uuid NOT NULL,
  expected_on date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (invoice_id, part)
);
CREATE INDEX IF NOT EXISTS pay_expect_invoice_company_idx ON public.pay_expect_invoice (company_id);

CREATE OR REPLACE FUNCTION public.pay_expect_project_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.projects WHERE id = NEW.project_id;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Project not found' USING ERRCODE = '42501'; END IF;
  NEW.company_id := v_co;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.pay_expect_invoice_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501'; END IF;
  NEW.company_id := v_co;
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS pay_expect_project_guard_t ON public.pay_expect_project;
CREATE TRIGGER pay_expect_project_guard_t
  BEFORE INSERT OR UPDATE ON public.pay_expect_project
  FOR EACH ROW EXECUTE FUNCTION public.pay_expect_project_guard();

DROP TRIGGER IF EXISTS pay_expect_invoice_guard_t ON public.pay_expect_invoice;
CREATE TRIGGER pay_expect_invoice_guard_t
  BEFORE INSERT OR UPDATE ON public.pay_expect_invoice
  FOR EACH ROW EXECUTE FUNCTION public.pay_expect_invoice_guard();

ALTER TABLE public.pay_expect_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_expect_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_expect_invoice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pay_expect_defaults, public.pay_expect_project, public.pay_expect_invoice FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pay_expect_defaults, public.pay_expect_project, public.pay_expect_invoice TO authenticated;

DROP POLICY IF EXISTS pay_expect_defaults_admin ON public.pay_expect_defaults;
CREATE POLICY pay_expect_defaults_admin ON public.pay_expect_defaults
  FOR ALL TO authenticated
  USING (public.can_update_company(auth.uid(), company_id))
  WITH CHECK (public.can_update_company(auth.uid(), company_id));
DROP POLICY IF EXISTS pay_expect_project_admin ON public.pay_expect_project;
CREATE POLICY pay_expect_project_admin ON public.pay_expect_project
  FOR ALL TO authenticated
  USING (public.can_update_company(auth.uid(), company_id))
  WITH CHECK (public.can_update_company(auth.uid(), company_id));
DROP POLICY IF EXISTS pay_expect_invoice_admin ON public.pay_expect_invoice;
CREATE POLICY pay_expect_invoice_admin ON public.pay_expect_invoice
  FOR ALL TO authenticated
  USING (public.can_update_company(auth.uid(), company_id))
  WITH CHECK (public.can_update_company(auth.uid(), company_id));

DROP POLICY IF EXISTS zz_no_accounts_bot ON public.pay_expect_defaults;
CREATE POLICY zz_no_accounts_bot ON public.pay_expect_defaults
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_accounts_bot()) WITH CHECK (NOT public.is_accounts_bot());
DROP POLICY IF EXISTS zz_no_accounts_bot ON public.pay_expect_project;
CREATE POLICY zz_no_accounts_bot ON public.pay_expect_project
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_accounts_bot()) WITH CHECK (NOT public.is_accounts_bot());
DROP POLICY IF EXISTS zz_no_accounts_bot ON public.pay_expect_invoice;
CREATE POLICY zz_no_accounts_bot ON public.pay_expect_invoice
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_accounts_bot()) WITH CHECK (NOT public.is_accounts_bot());

CREATE OR REPLACE FUNCTION public.save_pay_expect_defaults(
  p_company uuid,
  p_project_deposit_days int,
  p_project_final_days int,
  p_window_extra_days int,
  p_normal_deposit_days int,
  p_normal_final_days int,
  p_late_grace_days int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v public.pay_expect_defaults%ROWTYPE;
BEGIN
  PERFORM public._pay_expect_admin(p_company);
  IF p_project_deposit_days NOT BETWEEN 0 AND 365 OR p_project_final_days NOT BETWEEN 0 AND 365
     OR p_normal_deposit_days NOT BETWEEN 0 AND 365 OR p_normal_final_days NOT BETWEEN 0 AND 365
     OR p_window_extra_days NOT BETWEEN 0 AND 90 OR p_late_grace_days NOT BETWEEN 0 AND 90 THEN
    RAISE EXCEPTION 'Days are out of range' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pay_expect_defaults (
    company_id, project_deposit_days, project_final_days, window_extra_days,
    normal_deposit_days, normal_final_days, late_grace_days, updated_by
  ) VALUES (
    p_company, p_project_deposit_days, p_project_final_days, p_window_extra_days,
    p_normal_deposit_days, p_normal_final_days, p_late_grace_days, auth.uid()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    project_deposit_days = EXCLUDED.project_deposit_days,
    project_final_days = EXCLUDED.project_final_days,
    window_extra_days = EXCLUDED.window_extra_days,
    normal_deposit_days = EXCLUDED.normal_deposit_days,
    normal_final_days = EXCLUDED.normal_final_days,
    late_grace_days = EXCLUDED.late_grace_days,
    updated_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO v;
  RETURN to_jsonb(v);
END
$fn$;

CREATE OR REPLACE FUNCTION public.save_pay_expect_project(
  p_project uuid,
  p_clear boolean DEFAULT false,
  p_timing text DEFAULT NULL,
  p_date_mode text DEFAULT NULL,
  p_deposit_days int DEFAULT NULL,
  p_final_days int DEFAULT NULL,
  p_window_extra_days int DEFAULT NULL,
  p_day_of_month int DEFAULT NULL,
  p_month_offset int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_co uuid; v public.pay_expect_project%ROWTYPE; v_timing text; v_mode text;
BEGIN
  SELECT company_id INTO v_co FROM public.projects WHERE id = p_project;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Project not found' USING ERRCODE = '42501'; END IF;
  PERFORM public._pay_expect_admin(v_co);
  IF p_clear THEN
    DELETE FROM public.pay_expect_project WHERE project_id = p_project;
    RETURN jsonb_build_object('cleared', true);
  END IF;
  v_timing := nullif(lower(btrim(coalesce(p_timing, ''))), '');
  v_mode := nullif(lower(btrim(coalesce(p_date_mode, ''))), '');
  IF v_timing IS NOT NULL AND v_timing NOT IN ('project', 'normal') THEN
    RAISE EXCEPTION 'Timing must be project or normal' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('days_after', 'day_of_month', 'month_end') THEN
    RAISE EXCEPTION 'Date rule must be days after the invoice, a day of the month, or the last day' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'day_of_month' AND (p_day_of_month IS NULL OR p_day_of_month NOT BETWEEN 1 AND 31) THEN
    RAISE EXCEPTION 'Choose the day of the month' USING ERRCODE = '22023';
  END IF;
  IF p_deposit_days IS NOT NULL AND p_deposit_days NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'Days are out of range' USING ERRCODE = '22023'; END IF;
  IF p_final_days IS NOT NULL AND p_final_days NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'Days are out of range' USING ERRCODE = '22023'; END IF;
  IF p_window_extra_days IS NOT NULL AND p_window_extra_days NOT BETWEEN 0 AND 90 THEN RAISE EXCEPTION 'Days are out of range' USING ERRCODE = '22023'; END IF;
  IF p_month_offset IS NOT NULL AND p_month_offset NOT BETWEEN 0 AND 24 THEN RAISE EXCEPTION 'Month offset is out of range' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.pay_expect_project (
    project_id, company_id, timing, date_mode, deposit_days, final_days, window_extra_days, day_of_month, month_offset, updated_by
  ) VALUES (
    p_project, v_co, v_timing, v_mode, p_deposit_days, p_final_days, p_window_extra_days,
    CASE WHEN v_mode = 'day_of_month' THEN p_day_of_month ELSE NULL END,
    CASE WHEN v_mode IN ('day_of_month', 'month_end') THEN coalesce(p_month_offset, 0) ELSE NULL END,
    auth.uid()
  )
  ON CONFLICT (project_id) DO UPDATE SET
    timing = EXCLUDED.timing,
    date_mode = EXCLUDED.date_mode,
    deposit_days = EXCLUDED.deposit_days,
    final_days = EXCLUDED.final_days,
    window_extra_days = EXCLUDED.window_extra_days,
    day_of_month = EXCLUDED.day_of_month,
    month_offset = EXCLUDED.month_offset,
    updated_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO v;
  RETURN to_jsonb(v);
END
$fn$;

CREATE OR REPLACE FUNCTION public.save_pay_expect_invoice(
  p_invoice uuid, p_part text, p_expected_on date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_co uuid; v_part text := lower(btrim(coalesce(p_part, '')));
BEGIN
  SELECT company_id INTO v_co FROM public.invoices WHERE id = p_invoice;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '42501'; END IF;
  PERFORM public._pay_expect_admin(v_co);
  IF v_part NOT IN ('deposit', 'final') THEN RAISE EXCEPTION 'Kind must be deposit or final' USING ERRCODE = '22023'; END IF;
  IF p_expected_on IS NULL THEN
    DELETE FROM public.pay_expect_invoice WHERE invoice_id = p_invoice AND part = v_part;
    RETURN jsonb_build_object('cleared', true);
  END IF;
  INSERT INTO public.pay_expect_invoice (invoice_id, part, company_id, expected_on, updated_by)
  VALUES (p_invoice, v_part, v_co, p_expected_on, auth.uid())
  ON CONFLICT (invoice_id, part) DO UPDATE SET expected_on = EXCLUDED.expected_on, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('invoice_id', p_invoice, 'part', v_part, 'expected_on', p_expected_on);
END
$fn$;

-- What WALDA reads for the expected-money digest. Manual and WALDA rows win over the computed date.
CREATE OR REPLACE FUNCTION public.walda_read_expected_money(p_today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  co uuid := public._walda_co();
  v_today date := coalesce(p_today, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
  s public.pay_expect_defaults%ROWTYPE;
  inv record;
  q record;
  r record;
  o public.pay_expect_project%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_manual jsonb := '[]'::jsonb;
  v_replace jsonb := '{}'::jsonb;
  v_grace int;
  v_extra int;
  v_pct_default numeric := 70;
  v_paid numeric;
  v_credited numeric;
  v_balance numeric;
  v_part text;
  v_project uuid;
  v_houses int;
  v_project_rule boolean;
  v_mode text;
  v_days int;
  v_inv_day date;
  v_done date;
  v_on date;
  v_end date;
  v_estimate boolean;
  v_source text;
  v_force date;
  v_is_late boolean;
  v_label text;
  v_late_count int := 0;
  v_sorted jsonb;
BEGIN
  IF NOT public.is_company_writable(co) THEN RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.pay_expect_defaults WHERE company_id = co;
  IF NOT FOUND THEN
    s.project_deposit_days := 15; s.project_final_days := 15; s.window_extra_days := 5;
    s.normal_deposit_days := 3; s.normal_final_days := 7; s.late_grace_days := 3;
  END IF;
  v_grace := s.late_grace_days;
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    SELECT cs.default_deposit_percentage INTO v_pct_default
    FROM public.company_settings cs WHERE cs.company_id = co
    ORDER BY cs.updated_at DESC NULLS LAST LIMIT 1;
  END IF;

  IF to_regclass('public.cf_receipts') IS NOT NULL THEN
    FOR r IN
      SELECT id, source, invoice_id, quote_id, part, amount_incl, expected_date, client, ref, note
      FROM public.cf_receipts
      WHERE company_id = co AND source IN ('manual', 'walda') AND status = 'expected' AND amount_incl > 0
    LOOP
      IF r.invoice_id IS NOT NULL THEN
        IF r.part IN ('other', 'full', 'progress') THEN
          v_replace := v_replace || jsonb_build_object(r.invoice_id::text || ':*', true);
        ELSE
          v_replace := v_replace || jsonb_build_object(r.invoice_id::text || ':' || r.part, true);
        END IF;
      END IF;
      IF r.quote_id IS NOT NULL AND r.part IN ('deposit', 'other', 'full', 'progress') THEN
        v_replace := v_replace || jsonb_build_object('quote:' || r.quote_id::text, true);
      END IF;
      v_is_late := r.expected_date IS NOT NULL AND r.expected_date < v_today - v_grace;
      v_label := CASE
        WHEN r.expected_date IS NULL THEN 'No date'
        ELSE 'Expected ' || public._pay_expect_day_text(r.expected_date)
      END;
      IF v_is_late AND r.expected_date IS NOT NULL THEN v_label := 'Late · ' || v_label; v_late_count := v_late_count + 1; END IF;
      v_manual := v_manual || jsonb_build_array(jsonb_build_object(
        'invoice_id', r.invoice_id, 'quote_id', r.quote_id, 'part', r.part, 'amount', r.amount_incl,
        'expected_on', r.expected_date, 'window_end', NULL, 'label', v_label, 'estimate', false,
        'late', v_is_late, 'rule', NULL, 'date_mode', NULL, 'source', r.source,
        'client', coalesce(r.client, r.ref)
      ));
    END LOOP;
  END IF;

  FOR inv IN
    SELECT * FROM public.invoices i
    WHERE i.company_id = co
    ORDER BY i.issue_date NULLS LAST, i.id
    LIMIT 2000
  LOOP
    IF inv.archived_at IS NOT NULL THEN CONTINUE; END IF;
    IF lower(coalesce(inv.status, '')) IN ('paid', 'void', 'cancelled', 'canceled') THEN CONTINUE; END IF;
    IF lower(coalesce(inv.status, '')) = 'draft' AND inv.sent_at IS NULL THEN CONTINUE; END IF;
    v_paid := coalesce((
      SELECT sum(p.amount) FROM public.payments p
      WHERE p.invoice_id = inv.id AND (p.status IN ('paid', 'succeeded', 'completed') OR (p.status IS NULL AND p.gateway = 'manual'))
    ), 0);
    v_credited := 0;
    IF to_regclass('public.credit_notes') IS NOT NULL THEN
      EXECUTE 'SELECT coalesce(sum(total),0) FROM public.credit_notes WHERE invoice_id = $1 AND coalesce(status, ''issued'') = ''issued'''
        INTO v_credited USING inv.id;
    END IF;
    v_balance := round(greatest(0, coalesce(inv.grand_total, 0) - v_paid - v_credited), 2);
    IF v_balance <= 0.005 THEN CONTINUE; END IF;
    v_part := CASE WHEN upper(btrim(coalesce(inv.notes, ''))) LIKE 'DEPOSIT%' THEN 'deposit' ELSE 'final' END;
    IF v_replace ? (inv.id::text || ':*') OR v_replace ? (inv.id::text || ':' || v_part) THEN CONTINUE; END IF;

    v_project := public._pay_expect_project_for(co, inv.project_house_id, inv.id, inv.quote_id, inv.lead_id, inv.customer_id);
    v_houses := 0;
    o := NULL;
    IF v_project IS NOT NULL THEN
      SELECT count(*) INTO v_houses FROM public.project_houses h WHERE h.project_id = v_project;
      SELECT * INTO o FROM public.pay_expect_project WHERE project_id = v_project;
    END IF;
    v_project_rule := CASE
      WHEN o.timing = 'project' THEN true
      WHEN o.timing = 'normal' THEN false
      ELSE v_houses > 1
    END;
    v_mode := CASE WHEN v_project_rule THEN coalesce(o.date_mode, 'days_after') ELSE NULL END;
    v_days := CASE
      WHEN v_part = 'deposit' THEN coalesce(o.deposit_days, CASE WHEN v_project_rule THEN s.project_deposit_days ELSE s.normal_deposit_days END)
      ELSE coalesce(o.final_days, CASE WHEN v_project_rule THEN s.project_final_days ELSE s.normal_final_days END)
    END;
    v_extra := coalesce(o.window_extra_days, s.window_extra_days);
    v_inv_day := coalesce(inv.issue_date, (inv.sent_at AT TIME ZONE 'Africa/Johannesburg')::date, (inv.created_at AT TIME ZONE 'Africa/Johannesburg')::date);
    v_on := NULL; v_end := NULL; v_estimate := false; v_source := 'computed';
    SELECT expected_on INTO v_force FROM public.pay_expect_invoice WHERE invoice_id = inv.id AND part = v_part;
    IF v_force IS NOT NULL THEN
      v_on := v_force; v_source := 'override';
    ELSIF v_project_rule AND v_inv_day IS NOT NULL THEN
      IF v_mode = 'day_of_month' AND o.day_of_month IS NOT NULL THEN
        v_on := public._pay_expect_on(v_inv_day, 'day_of_month', v_days, o.day_of_month, coalesce(o.month_offset, 0));
      ELSIF v_mode = 'month_end' THEN
        v_on := public._pay_expect_on(v_inv_day, 'month_end', v_days, NULL, coalesce(o.month_offset, 0));
      ELSE
        v_mode := 'days_after';
        v_on := public._pay_expect_on(v_inv_day, 'days_after', v_days, NULL, 0);
        IF v_extra > 0 THEN v_end := v_on + v_extra; END IF;
      END IF;
    ELSIF NOT v_project_rule THEN
      IF v_part = 'deposit' AND v_inv_day IS NOT NULL THEN
        v_on := v_inv_day + v_days;
      ELSIF v_part = 'final' THEN
        SELECT max((j.completed_at AT TIME ZONE 'Africa/Johannesburg')::date) INTO v_done
        FROM public.jobs j
        WHERE j.company_id = co AND j.completed_at IS NOT NULL AND (
          j.invoice_id = inv.id
          OR (inv.quote_id IS NOT NULL AND j.quote_id = inv.quote_id)
          OR (inv.lead_id IS NOT NULL AND j.lead_id = inv.lead_id)
        );
        IF v_done IS NOT NULL THEN v_on := v_done + v_days;
        ELSIF v_inv_day IS NOT NULL THEN v_on := v_inv_day + v_days; v_estimate := true;
        END IF;
      END IF;
    END IF;
    v_is_late := v_on IS NOT NULL AND v_on < v_today - v_grace;
    IF v_on IS NULL THEN v_label := 'No date';
    ELSE
      v_label := 'Expected ' || public._pay_expect_day_text(v_on);
      IF v_end IS NOT NULL AND v_end <> v_on THEN
        IF to_char(v_on, 'YYYY-MM') = to_char(v_end, 'YYYY-MM') THEN
          v_label := v_label || ' (' || extract(day FROM v_on)::int || ' to ' || public._pay_expect_day_text(v_end) || ')';
        ELSE
          v_label := v_label || ' (' || public._pay_expect_day_text(v_on) || ' to ' || public._pay_expect_day_text(v_end) || ')';
        END IF;
      END IF;
      IF v_estimate THEN v_label := v_label || ' · estimate'; END IF;
      IF v_is_late THEN v_label := 'Late · ' || v_label; v_late_count := v_late_count + 1; END IF;
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'invoice_id', inv.id, 'quote_id', inv.quote_id, 'part', v_part, 'amount', v_balance,
      'expected_on', v_on, 'window_end', v_end, 'label', v_label, 'estimate', v_estimate,
      'late', coalesce(v_is_late, false),
      'rule', CASE WHEN v_project_rule THEN 'project' ELSE 'normal' END,
      'date_mode', v_mode, 'source', v_source,
      'client', inv.customer_name, 'ref', inv.invoice_number
    ));
  END LOOP;

  IF to_regclass('public.quotes') IS NOT NULL THEN
    FOR q IN
      SELECT * FROM public.quotes
      WHERE company_id = co AND archived_at IS NULL AND accepted_at IS NOT NULL
        AND (lower(status) = 'accepted' OR accepted_at IS NOT NULL)
      LIMIT 2000
    LOOP
      IF v_replace ? ('quote:' || q.id::text) THEN CONTINUE; END IF;
      IF EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.company_id = co AND i.quote_id = q.id AND i.archived_at IS NULL
          AND lower(coalesce(i.status, '')) NOT IN ('void', 'cancelled', 'canceled')
      ) THEN CONTINUE; END IF;
      v_project := public._pay_expect_project_for(co, NULL, NULL, q.id, NULL, q.customer_id);
      v_houses := 0; o := NULL;
      IF v_project IS NOT NULL THEN
        SELECT count(*) INTO v_houses FROM public.project_houses h WHERE h.project_id = v_project;
        SELECT * INTO o FROM public.pay_expect_project WHERE project_id = v_project;
      END IF;
      v_project_rule := CASE WHEN o.timing = 'project' THEN true WHEN o.timing = 'normal' THEN false ELSE v_houses > 1 END;
      IF v_project_rule THEN CONTINUE; END IF;
      v_days := coalesce(o.deposit_days, s.normal_deposit_days);
      v_balance := round(coalesce(q.total, 0) * public._pay_expect_deposit_pct(q.payment_plan, v_pct_default) / 100, 2);
      IF v_balance <= 0.005 THEN CONTINUE; END IF;
      v_inv_day := (q.accepted_at AT TIME ZONE 'Africa/Johannesburg')::date;
      v_on := v_inv_day + v_days;
      v_is_late := v_on < v_today - v_grace;
      v_label := 'Expected ' || public._pay_expect_day_text(v_on);
      IF v_is_late THEN v_label := 'Late · ' || v_label; v_late_count := v_late_count + 1; END IF;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'invoice_id', NULL, 'quote_id', q.id, 'part', 'deposit', 'amount', v_balance,
        'expected_on', v_on, 'window_end', NULL, 'label', v_label, 'estimate', false,
        'late', v_is_late, 'rule', 'normal', 'date_mode', NULL, 'source', 'acceptance',
        'client', q.customer_name, 'ref', q.quote_number
      ));
    END LOOP;
  END IF;

  v_lines := v_lines || v_manual;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'expected_on' NULLS LAST, x->>'client', x->>'part'), '[]'::jsonb)
    INTO v_sorted FROM jsonb_array_elements(v_lines) x;
  PERFORM public._bot_audit(co, 'expected_money_read', 'expected_pay', NULL, NULL,
    jsonb_build_object('lines', jsonb_array_length(v_sorted), 'late', v_late_count, 'today', v_today));
  RETURN jsonb_build_object('today', v_today, 'late_grace_days', v_grace, 'lines', v_sorted);
END
$fn$;

REVOKE ALL ON FUNCTION public._pay_expect_day_text(date), public._pay_expect_names_house(text, text),
  public._pay_expect_on(date, text, int, int, int), public._pay_expect_deposit_pct(jsonb, numeric),
  public._pay_expect_project_for(uuid, uuid, uuid, uuid, uuid, uuid), public._pay_expect_admin(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_pay_expect_defaults(uuid, int, int, int, int, int, int),
  public.save_pay_expect_project(uuid, boolean, text, text, int, int, int, int, int),
  public.save_pay_expect_invoice(uuid, text, date),
  public.walda_read_expected_money(date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pay_expect_defaults(uuid, int, int, int, int, int, int),
  public.save_pay_expect_project(uuid, boolean, text, text, int, int, int, int, int),
  public.save_pay_expect_invoice(uuid, text, date),
  public.walda_read_expected_money(date)
  TO authenticated;

COMMENT ON FUNCTION public.walda_read_expected_money(date) IS
  'Expected money for the WALDA digest. Project timing is several houses, or a forced project rule. Dates are days after the invoice (with the window), a day of the month, or the month end. A per-invoice date wins. A manual or WALDA row wins over the computed date. Paid, void, cancelled and archived invoices are left out. Does not change invoices or payments.';
