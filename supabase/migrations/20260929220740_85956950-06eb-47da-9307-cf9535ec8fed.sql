-- Job 6: tech pay = paid on completion 40% + holdback 10% (45 days) of labour sell ex VAT; tools 10% retained by the company.
-- 1) Company settings (admin/owner only; columns are not in the authenticated column-level SELECT grant)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS tech_paid_on_completion_pct numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS tech_holdback_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS tech_holdback_days integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS tools_retained_pct numeric NOT NULL DEFAULT 10;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_tech_pay_settings_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_tech_pay_settings_check CHECK (
  tech_paid_on_completion_pct BETWEEN 0 AND 100 AND tech_holdback_pct BETWEEN 0 AND 100 AND tools_retained_pct BETWEEN 0 AND 100
  AND tech_paid_on_completion_pct + tech_holdback_pct + tools_retained_pct <= 100 AND tech_holdback_days BETWEEN 0 AND 3650);

CREATE OR REPLACE FUNCTION public.guard_company_tech_pay_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.tech_paid_on_completion_pct IS DISTINCT FROM OLD.tech_paid_on_completion_pct
      OR NEW.tech_holdback_pct IS DISTINCT FROM OLD.tech_holdback_pct
      OR NEW.tech_holdback_days IS DISTINCT FROM OLD.tech_holdback_days
      OR NEW.tools_retained_pct IS DISTINCT FROM OLD.tools_retained_pct)
     AND auth.uid() IS NOT NULL AND NOT public.is_company_admin(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Only a company admin or the owner can change tech pay settings';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_company_tech_pay_settings ON public.companies;
CREATE TRIGGER trg_guard_company_tech_pay_settings BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_tech_pay_settings();

CREATE OR REPLACE FUNCTION public.get_company_tech_pay_settings(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('company_id', c.id, 'tech_paid_on_completion_pct', c.tech_paid_on_completion_pct,
    'tech_holdback_pct', c.tech_holdback_pct, 'tech_holdback_days', c.tech_holdback_days, 'tools_retained_pct', c.tools_retained_pct,
    'company_labour_pct', 100 - c.tech_paid_on_completion_pct - c.tech_holdback_pct)
  FROM public.companies c
  WHERE c.id = p_company_id AND auth.uid() IS NOT NULL AND public.is_company_admin(auth.uid(), c.id);
$$;

CREATE OR REPLACE FUNCTION public.set_company_tech_pay_settings(p_company_id uuid, p_paid_pct numeric, p_holdback_pct numeric,
  p_holdback_days integer, p_tools_pct numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_admin(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Only a company admin or the owner can change tech pay settings';
  END IF;
  IF p_paid_pct IS NULL OR p_holdback_pct IS NULL OR p_holdback_days IS NULL OR p_tools_pct IS NULL
     OR p_paid_pct < 0 OR p_holdback_pct < 0 OR p_tools_pct < 0 OR p_holdback_days < 0 OR p_holdback_days > 3650
     OR p_paid_pct + p_holdback_pct + p_tools_pct > 100 THEN
    RAISE EXCEPTION 'Percentages must be 0 or more and add up to 100 or less; holdback days 0-3650';
  END IF;
  UPDATE public.companies SET tech_paid_on_completion_pct = p_paid_pct, tech_holdback_pct = p_holdback_pct,
         tech_holdback_days = p_holdback_days, tools_retained_pct = p_tools_pct
   WHERE id = p_company_id;
  RETURN public.get_company_tech_pay_settings(p_company_id);
END $$;

-- 2) Tech rule: paid + held components for the tech; tools retained is company money (not a tech part)
CREATE OR REPLACE FUNCTION public.earnings_tech_rule(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('version','tech_v2_paid_held_tools','basis','labour_sell_ex_vat',
    'parts', jsonb_build_array(
      jsonb_build_object('kind','paid','label','Paid on completion','percent', COALESCE(c.tech_paid_on_completion_pct, 40),'hold_days',0),
      jsonb_build_object('kind','held','label','Holdback','percent', COALESCE(c.tech_holdback_pct, 10),'hold_days', COALESCE(c.tech_holdback_days, 45))),
    'tools_percent', COALESCE(c.tools_retained_pct, 10))
  FROM (SELECT 1) one LEFT JOIN public.companies c ON c.id = p_company_id;
$$;

-- 3) Owner company block gains tools_keep (labour_keep already includes it: labour sell minus tech paid+held)
DO $m$ DECLARE d text := pg_get_functiondef('public._earnings_for_quote(uuid,uuid)'::regprocedure);
  f text := '      ''discount'', round(v_disc, 2)));';
BEGIN
  IF (length(d) - length(replace(d, f, ''))) / length(f) <> 1 THEN RAISE EXCEPTION 'fragment not found once in _earnings_for_quote'; END IF;
  EXECUTE replace(d, f, '      ''discount'', round(v_disc, 2),
      ''tools_percent'', COALESCE((v_trule->>''tools_percent'')::numeric, 0),
      ''tools_keep'', round(v_lab_sell * COALESCE((v_trule->>''tools_percent'')::numeric, 0) / 100, 2)));');
END $m$;

-- 4) Money flow: company labour excludes tools; tools is its own company segment. tech_held appears from the rule parts.
DO $m$ DECLARE d text := pg_get_functiondef('public.get_owner_money_flow(uuid)'::regprocedure);
  f text := $f$        ('company_labour',   'company', 'Company keeps · labour',                21, COALESCE((f.e->'company'->>'labour_keep')::numeric,0)),$f$;
BEGIN
  IF (length(d) - length(replace(d, f, ''))) / length(f) <> 1 THEN RAISE EXCEPTION 'fragment not found once in get_owner_money_flow'; END IF;
  EXECUTE replace(d, f, $r$        ('company_labour',   'company', 'Company keeps · labour',                21, COALESCE((f.e->'company'->>'labour_keep')::numeric,0) - COALESCE((f.e->'company'->>'tools_keep')::numeric,0)),
        ('company_tools',    'company', 'Company keeps · tools share',           23, COALESCE((f.e->'company'->>'tools_keep')::numeric,0)),$r$);
END $m$;

-- 5) Ledger: one row per tech per job per bucket, frozen when the job is completed
CREATE TABLE IF NOT EXISTS public.tech_earnings_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  quote_id uuid,
  quote_number text,
  tech_id uuid NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('paid_on_completion','holdback')),
  percent numeric NOT NULL,
  labour_base numeric,
  amount numeric NOT NULL,
  reduction_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL,
  completed_at timestamptz,
  release_after date,
  callback_job_id uuid,
  rule jsonb,
  paid_at date,
  note text,
  status_changed_at timestamptz,
  status_changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, tech_id, bucket),
  CHECK ((bucket = 'paid_on_completion' AND status IN ('accrued','payable','paid'))
      OR (bucket = 'holdback' AND status IN ('held','released','reduced'))),
  CHECK (reduction_amount >= 0 AND reduction_amount <= amount)
);
ALTER TABLE public.tech_earnings_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tech or owner reads tech earnings" ON public.tech_earnings_ledger;
CREATE POLICY "Tech or owner reads tech earnings" ON public.tech_earnings_ledger
  FOR SELECT TO authenticated USING (tech_id = auth.uid() OR public.is_company_owner(auth.uid(), company_id));
REVOKE ALL ON public.tech_earnings_ledger FROM anon, authenticated;
GRANT SELECT ON public.tech_earnings_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public._create_tech_ledger_for_job(p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; v_q record; v_co uuid; v_t uuid; e jsonb; me jsonb; p jsonb; v_bucket text; v_amt numeric; v_pct numeric;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND OR j.quote_id IS NULL OR j.status IS DISTINCT FROM 'completed' THEN RETURN; END IF;
  SELECT id, quote_number, company_id, status INTO v_q FROM public.quotes WHERE id = j.quote_id;
  IF NOT FOUND OR v_q.status IS DISTINCT FROM 'accepted' THEN RETURN; END IF;
  v_co := COALESCE(v_q.company_id, j.company_id);
  FOR v_t IN SELECT DISTINCT a.profile_id FROM public.jobs jj JOIN public.assignments a ON a.job_id = jj.id
              WHERE jj.quote_id = j.quote_id AND a.profile_id IS NOT NULL
                AND COALESCE(a.status,'') NOT IN ('declined','rejected','cancelled') LOOP
    e := public._earnings_for_quote(j.quote_id, v_t);
    me := e->'tech'->'me';
    CONTINUE WHEN me IS NULL;
    FOR p IN SELECT x FROM jsonb_array_elements(COALESCE(me->'parts','[]'::jsonb)) x LOOP
      v_bucket := CASE p->>'kind' WHEN 'paid' THEN 'paid_on_completion' WHEN 'held' THEN 'holdback' END;
      v_amt := COALESCE((p->>'amount')::numeric, 0); v_pct := COALESCE((p->>'percent')::numeric, 0);
      CONTINUE WHEN v_bucket IS NULL OR v_amt <= 0;
      -- never pay the same quote labour twice (e.g. a second job on the same quote)
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.tech_earnings_ledger l WHERE l.quote_id = j.quote_id AND l.tech_id = v_t AND l.bucket = v_bucket);
      INSERT INTO public.tech_earnings_ledger (company_id, job_id, quote_id, quote_number, tech_id, bucket, percent, labour_base,
          amount, status, completed_at, release_after, rule)
      VALUES (v_co, j.id, j.quote_id, v_q.quote_number, v_t, v_bucket, v_pct,
          CASE WHEN (me->>'percent')::numeric > 0 THEN round((me->>'amount')::numeric * 100 / (me->>'percent')::numeric, 2) END,
          v_amt, CASE WHEN v_bucket = 'holdback' THEN 'held' ELSE 'payable' END, j.completed_at,
          CASE WHEN v_bucket = 'holdback' THEN (COALESCE(j.completed_at, now()) AT TIME ZONE 'Africa/Johannesburg')::date + COALESCE((p->>'hold_days')::int, 0) END,
          jsonb_build_object('version', e->'tech'->>'rule_version', 'part', p - 'amount', 'tech_count', e->'tech'->'tech_count'))
      ON CONFLICT (job_id, tech_id, bucket) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_create_tech_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    BEGIN
      PERFORM public._create_tech_ledger_for_job(NEW.id);
    EXCEPTION WHEN others THEN RAISE WARNING 'tech earnings ledger skipped: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_create_tech_ledger ON public.jobs;
CREATE TRIGGER trg_create_tech_ledger AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_tech_ledger();

-- 6) Tracker. Tech: own rows only. Owner: every tech in the companies they own. Everyone else: nothing.
--    Frozen ledger rows + live 'accrued' rows for accepted quotes whose job is not completed yet.
CREATE OR REPLACE FUNCTION public.get_tech_earnings(p_tech_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_cos uuid[]; v_master uuid; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_cos := ARRAY(SELECT company_id FROM public.company_members WHERE user_id = v_uid AND role = 'admin' AND is_owner);
  v_master := (SELECT id FROM public.companies WHERE is_master ORDER BY created_at LIMIT 1);
  WITH pairs AS (
    SELECT DISTINCT qt.id AS quote_id, qt.quote_number, a.profile_id AS tech_id
      FROM public.quotes qt JOIN public.jobs jj ON jj.quote_id = qt.id JOIN public.assignments a ON a.job_id = jj.id
     WHERE qt.status = 'accepted' AND a.profile_id IS NOT NULL AND COALESCE(a.status,'') NOT IN ('declined','rejected','cancelled')
       AND (a.profile_id = v_uid OR COALESCE(qt.company_id, v_master) = ANY(v_cos))
       AND (p_tech_id IS NULL OR a.profile_id = p_tech_id)
       AND NOT EXISTS (SELECT 1 FROM public.jobs jc WHERE jc.quote_id = qt.id AND jc.status = 'completed')
       AND NOT EXISTS (SELECT 1 FROM public.tech_earnings_ledger l WHERE l.quote_id = qt.id AND l.tech_id = a.profile_id)
     LIMIT 500
  ), live AS (
    SELECT pr.*, public._earnings_for_quote(pr.quote_id, pr.tech_id)->'tech'->'me' AS me FROM pairs pr
  ), r AS (
    SELECT NULL::uuid AS id, false AS frozen, NULL::uuid AS job_id, lv.quote_id, lv.quote_number, lv.tech_id,
           CASE p->>'kind' WHEN 'paid' THEN 'paid_on_completion' ELSE 'holdback' END AS bucket,
           (p->>'percent')::numeric AS percent, (p->>'amount')::numeric AS amount, 0::numeric AS reduction_amount,
           (p->>'amount')::numeric AS net_amount, 'accrued'::text AS status, NULL::timestamptz AS completed_at,
           NULL::date AS release_after, false AS releasable, NULL::uuid AS callback_job_id, NULL::date AS paid_at
      FROM live lv, jsonb_array_elements(COALESCE(lv.me->'parts','[]'::jsonb)) p
     WHERE p->>'kind' IN ('paid','held') AND COALESCE((p->>'amount')::numeric,0) > 0
    UNION ALL
    SELECT l.id, true, l.job_id, l.quote_id, COALESCE((SELECT quote_number FROM public.quotes WHERE id = l.quote_id), l.quote_number), l.tech_id,
           l.bucket, l.percent, l.amount, l.reduction_amount, l.amount - l.reduction_amount, l.status, l.completed_at,
           l.release_after, (l.status = 'held' AND l.callback_job_id IS NULL AND l.release_after <= v_today), l.callback_job_id, l.paid_at
      FROM public.tech_earnings_ledger l
     WHERE (l.tech_id = v_uid OR l.company_id = ANY(v_cos)) AND (p_tech_id IS NULL OR l.tech_id = p_tech_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object('tech_name', (SELECT full_name FROM public.profiles WHERE id = r.tech_id))
           ORDER BY r.completed_at DESC NULLS FIRST, r.quote_number, r.tech_id, r.bucket DESC), '[]'::jsonb) INTO v_rows FROM r;
  RETURN jsonb_build_object('api_version', 1, 'user_id', v_uid, 'is_owner', cardinality(v_cos) > 0, 'today', v_today, 'rows', v_rows);
END $$;

-- 7) Owner-only status changes: paid / unpay (paid_on_completion); release / reduce / undo (holdback)
CREATE OR REPLACE FUNCTION public.set_tech_earning_status(p_id uuid, p_action text, p_callback_job_id uuid DEFAULT NULL,
  p_reduction numeric DEFAULT NULL, p_paid_at date DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.tech_earnings_ledger; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  SELECT * INTO l FROM public.tech_earnings_ledger WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Earnings record not found'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_company_owner(auth.uid(), l.company_id) THEN
    RAISE EXCEPTION 'Only the company owner can change tech earnings';
  END IF;
  IF p_action = 'paid' AND l.bucket = 'paid_on_completion' AND l.status = 'payable' THEN
    UPDATE public.tech_earnings_ledger SET status = 'paid', paid_at = COALESCE(p_paid_at, v_today) WHERE id = p_id;
  ELSIF p_action = 'unpay' AND l.bucket = 'paid_on_completion' AND l.status = 'paid' THEN
    UPDATE public.tech_earnings_ledger SET status = 'payable', paid_at = NULL WHERE id = p_id;
  ELSIF p_action = 'release' AND l.bucket = 'holdback' AND l.status = 'held' THEN
    IF l.callback_job_id IS NOT NULL THEN RAISE EXCEPTION 'A callback is linked; reduce instead of releasing'; END IF;
    IF l.release_after > v_today THEN RAISE EXCEPTION 'Holdback can be released from %', l.release_after; END IF;
    UPDATE public.tech_earnings_ledger SET status = 'released', paid_at = COALESCE(p_paid_at, v_today) WHERE id = p_id;
  ELSIF p_action = 'reduce' AND l.bucket = 'holdback' AND l.status = 'held' THEN
    IF p_callback_job_id IS NULL OR p_callback_job_id = l.job_id
       OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_callback_job_id AND company_id = l.company_id) THEN
      RAISE EXCEPTION 'Link the callback job (another job of this company) to reduce a holdback';
    END IF;
    IF COALESCE(p_reduction, l.amount) < 0 OR COALESCE(p_reduction, l.amount) > l.amount THEN
      RAISE EXCEPTION 'Reduction must be between 0 and %', l.amount;
    END IF;
    UPDATE public.tech_earnings_ledger SET status = 'reduced', callback_job_id = p_callback_job_id,
           reduction_amount = COALESCE(p_reduction, l.amount), paid_at = COALESCE(p_paid_at, v_today) WHERE id = p_id;
  ELSIF p_action = 'undo' AND l.bucket = 'holdback' AND l.status IN ('released','reduced') THEN
    UPDATE public.tech_earnings_ledger SET status = 'held', callback_job_id = NULL, reduction_amount = 0, paid_at = NULL WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Action % is not allowed for a % record with status %', p_action, l.bucket, l.status;
  END IF;
  UPDATE public.tech_earnings_ledger SET status_changed_at = now(), status_changed_by = auth.uid(),
         note = COALESCE(p_note, note) WHERE id = p_id RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.guard_company_tech_pay_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._create_tech_ledger_for_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_create_tech_ledger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.earnings_tech_rule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_company_tech_pay_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_company_tech_pay_settings(uuid, numeric, numeric, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_tech_earnings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_tech_earning_status(uuid, text, uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_tech_pay_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_tech_pay_settings(uuid, numeric, numeric, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tech_earnings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tech_earning_status(uuid, text, uuid, numeric, date, text) TO authenticated;