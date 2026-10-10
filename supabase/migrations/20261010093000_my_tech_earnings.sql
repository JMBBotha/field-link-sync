-- Tech "My earnings" (Johan 09:27): own rows only, labour share only (no percent/labour base/quote/invoice figures).
CREATE OR REPLACE FUNCTION public.get_my_tech_earnings()
RETURNS TABLE(row_key text, job_id uuid, job_name text, job_date date, hours numeric, kind text, status text, amount numeric, release_after date, paid_at date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH led AS (
    SELECT l.id::text AS rk, l.job_id AS jid, l.bucket, l.status AS st, (l.amount - COALESCE(l.reduction_amount, 0)) AS amt,
           l.completed_at, l.release_after AS ra, l.paid_at AS pa, l.rule
      FROM public.tech_earnings_ledger l WHERE l.tech_id = v_uid
  ), pairs AS (
    SELECT DISTINCT ON (qt.id) jj.id AS jid, qt.id AS qid, jj.scheduled_for
      FROM public.quotes qt JOIN public.jobs jj ON jj.quote_id = qt.id JOIN public.assignments a ON a.job_id = jj.id
     WHERE qt.status = 'accepted' AND a.profile_id = v_uid AND jj.status <> 'cancelled'
       AND COALESCE(a.status, '') NOT IN ('declined', 'rejected', 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM public.jobs jc WHERE jc.quote_id = qt.id AND jc.status = 'completed')
       AND NOT EXISTS (SELECT 1 FROM public.tech_earnings_ledger l WHERE l.quote_id = qt.id AND l.tech_id = v_uid)
     ORDER BY qt.id, jj.created_at DESC
     LIMIT 200
  ), live AS (
    SELECT p.*, public._earnings_for_quote(p.qid, v_uid)->'tech'->'me' AS me FROM pairs p
  ), x AS (
    SELECT led.rk, led.jid, (led.completed_at AT TIME ZONE 'Africa/Johannesburg')::date AS d,
           COALESCE((SELECT sum(t.hours_onsite) FROM public.job_time_entries t JOIN public.jobs j2 ON j2.lead_id = t.lead_id
                      WHERE j2.id = led.jid AND t.agent_id = v_uid),
                    NULLIF(led.rule->'me'->>'hours', '')::numeric, NULLIF(led.rule->>'hours', '')::numeric) AS h,
           CASE WHEN led.bucket = 'holdback' THEN 'retention' ELSE 'completion' END AS k, led.st, led.amt, led.ra, led.pa
      FROM led
    UNION ALL
    SELECT lv.jid::text || ':' || (p->>'kind'), lv.jid, (lv.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date,
           NULLIF(lv.me->>'hours', '')::numeric,
           CASE WHEN p->>'kind' = 'held' THEN 'retention' ELSE 'completion' END, 'accrued', (p->>'amount')::numeric, NULL::date, NULL::date
      FROM live lv, jsonb_array_elements(COALESCE(lv.me->'parts', '[]'::jsonb)) p
     WHERE p->>'kind' IN ('paid', 'held') AND COALESCE((p->>'amount')::numeric, 0) > 0
  )
  SELECT x.rk, x.jid, COALESCE(NULLIF(trim(j.title), ''), ld.customer_name, 'Job'), x.d, round(x.h, 2), x.k, x.st, round(x.amt, 2), x.ra, x.pa
    FROM x LEFT JOIN public.jobs j ON j.id = x.jid LEFT JOIN public.leads ld ON ld.id = j.lead_id
   ORDER BY x.d DESC NULLS FIRST, x.rk;
END $$;
REVOKE ALL ON FUNCTION public.get_my_tech_earnings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tech_earnings() TO authenticated;
