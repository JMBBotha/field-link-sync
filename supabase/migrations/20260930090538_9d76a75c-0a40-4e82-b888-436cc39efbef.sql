-- STEP 3 (2026-09-30): sales reps see only their own + unassigned-available leads; own appointments RPC.
-- a) who created a lead (so a rep keeps seeing a lead they create and assign to someone else)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

-- b) rep lead visibility
CREATE OR REPLACE FUNCTION public.rep_can_see_lead(_uid uuid, _lead uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND ((l.status = 'pending' AND l.assigned_agent_id IS NULL) OR l.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid)
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = _lead AND (q.sales_engineer_id = _uid OR q.created_by = _uid));
$$;
REVOKE ALL ON FUNCTION public.rep_can_see_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_can_see_lead(uuid, uuid) TO authenticated, service_role;

-- c) RESTRICTIVE: only affects sales reps (is_sales_rep excludes admins, office dispatchers, techs)
DROP POLICY IF EXISTS rh_rep_scope ON public.leads;
-- Row columns are checked directly so INSERT ... RETURNING of a just-created row passes (an SD helper can't see the new row yet).
CREATE POLICY rh_rep_scope ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((NOT (SELECT public.is_sales_rep(auth.uid())))
         OR created_by = auth.uid() OR assigned_agent_id = auth.uid()
         OR (status = 'pending' AND assigned_agent_id IS NULL)
         OR public.rep_can_see_lead(auth.uid(), id));

-- c2) same fix for the step 2 tech scope on leads (techs creating/claiming a lead with RETURNING).
ALTER POLICY rh_tech_scope ON public.leads
  USING ((NOT (SELECT public.is_field_tech_only(auth.uid())))
         OR assigned_agent_id = auth.uid()
         OR (status = 'pending' AND assigned_agent_id IS NULL)
         OR public.tech_can_see_lead(auth.uid(), id));

-- d) caller's own upcoming appointments (+ unassigned pool), soonest first. SECURITY INVOKER: RLS still applies.
CREATE OR REPLACE FUNCTION public.get_my_appointments(p_days integer DEFAULT 60)
RETURNS TABLE(lead_id uuid, scheduled_date date, scheduled_time time, customer_name text, address text,
              service_type text, status text, is_mine boolean, source text, quote_id uuid, customer_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
  s AS (
    SELECT l.id AS lead_id, l.scheduled_date AS d, l.scheduled_time AS t,
           (l.assigned_agent_id IS NOT DISTINCT FROM auth.uid()) AS mine, 'lead'::text AS src
      FROM public.leads l, today
     WHERE l.scheduled_date BETWEEN today.d AND today.d + GREATEST(COALESCE(p_days, 60), 0)
       AND (l.assigned_agent_id = auth.uid() OR (l.assigned_agent_id IS NULL AND l.status = 'pending'))
    UNION ALL
    SELECT js.lead_id, js.scheduled_date, js.start_time, true, 'schedule'
      FROM public.job_schedules js, today
     WHERE js.agent_id = auth.uid() AND js.lead_id IS NOT NULL
       AND js.scheduled_date BETWEEN today.d AND today.d + GREATEST(COALESCE(p_days, 60), 0)
  ),
  picked AS (
    SELECT DISTINCT ON (s.lead_id, s.d) s.* FROM s ORDER BY s.lead_id, s.d, s.mine DESC, s.src
  )
  SELECT l.id, p.d, p.t, l.customer_name, COALESCE(NULLIF(l.customer_address, ''), l.normalized_address),
         l.service_type, l.status, p.mine, p.src,
         (SELECT q.id FROM public.quotes q WHERE q.lead_id = l.id ORDER BY q.created_at DESC LIMIT 1),
         l.customer_id
    FROM picked p JOIN public.leads l ON l.id = p.lead_id
   WHERE COALESCE(l.status, '') NOT IN ('cancelled', 'completed', 'converted')
     AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND l.company_id = public.get_user_company_id(auth.uid())
   ORDER BY p.d, p.t NULLS LAST, l.customer_name;
$$;
REVOKE ALL ON FUNCTION public.get_my_appointments(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_appointments(integer) TO authenticated;