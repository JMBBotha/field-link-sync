ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS work_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS work_start time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS work_end time NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS office_address text,
  ADD COLUMN IF NOT EXISTS office_lat double precision,
  ADD COLUMN IF NOT EXISTS office_lng double precision;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS office_address text,
  ADD COLUMN IF NOT EXISTS office_lat double precision,
  ADD COLUMN IF NOT EXISTS office_lng double precision,
  ADD COLUMN IF NOT EXISTS start_from text CHECK (start_from IN ('home','office'));

CREATE TABLE public.staff_work_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  company_id uuid NOT NULL,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time, end_time time,
  is_working boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (profile_id, day_of_week)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_work_hours TO authenticated;
GRANT ALL ON public.staff_work_hours TO service_role;
ALTER TABLE public.staff_work_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY swh_select ON public.staff_work_hours FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.rh_ops_ok(company_id));
CREATE POLICY swh_insert ON public.staff_work_hours FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()));
CREATE POLICY swh_update ON public.staff_work_hours FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()))
  WITH CHECK (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()));
CREATE POLICY swh_delete ON public.staff_work_hours FOR DELETE TO authenticated
  USING (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()));

CREATE TABLE public.staff_blocked_time (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  company_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  kind text NOT NULL DEFAULT 'blocked' CHECK (kind IN ('leave','blocked')),
  reason text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  archived_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.staff_blocked_time TO authenticated;
GRANT ALL ON public.staff_blocked_time TO service_role;
ALTER TABLE public.staff_blocked_time ENABLE ROW LEVEL SECURITY;
CREATE POLICY sbt_select ON public.staff_blocked_time FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.rh_ops_ok(company_id));
CREATE POLICY sbt_insert ON public.staff_blocked_time FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()));
CREATE POLICY sbt_update ON public.staff_blocked_time FOR UPDATE TO authenticated
  USING (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()))
  WITH CHECK (profile_id = auth.uid() OR (public.has_role(auth.uid(),'admin') AND company_id = public.caller_company_id()));

CREATE TABLE public.staff_home_bases (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id),
  address text, lat double precision, lng double precision,
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_home_bases TO authenticated;
GRANT ALL ON public.staff_home_bases TO service_role;
ALTER TABLE public.staff_home_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY shb_own ON public.staff_home_bases FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

CREATE OR REPLACE FUNCTION public.staff_work_window(p_profile_id uuid, p_date date)
RETURNS TABLE(is_working boolean, start_time time, end_time time, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid; v_dow int := extract(dow FROM p_date)::int;
  r_work boolean; r_start time; r_end time; r_src text;
  c_days int[]; c_start time; c_end time;
BEGIN
  SELECT company_id INTO v_company FROM public.profiles WHERE id = p_profile_id;
  IF NOT (auth.uid() IS NULL OR p_profile_id = auth.uid() OR public.rh_ops_ok(v_company)) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT h.is_working, h.start_time, h.end_time INTO r_work, r_start, r_end
    FROM public.staff_work_hours h WHERE h.profile_id = p_profile_id AND h.day_of_week = v_dow;
  IF FOUND THEN
    r_src := 'person'; r_start := COALESCE(r_start, '08:00'); r_end := COALESCE(r_end, '17:00');
  ELSE
    SELECT c.work_days, c.work_start, c.work_end INTO c_days, c_start, c_end FROM public.companies c WHERE c.id = v_company;
    IF FOUND AND c_days IS NOT NULL THEN
      r_src := 'company'; r_work := v_dow = ANY(c_days); r_start := c_start; r_end := c_end;
    ELSE
      r_src := 'default'; r_work := v_dow BETWEEN 1 AND 5; r_start := '08:00'; r_end := '17:00';
    END IF;
  END IF;
  IF r_work AND EXISTS (SELECT 1 FROM public.staff_blocked_time b
      WHERE b.profile_id = p_profile_id AND b.kind = 'leave' AND b.archived_at IS NULL
        AND b.starts_at <= ((p_date + r_start) AT TIME ZONE 'Africa/Johannesburg')
        AND b.ends_at >= ((p_date + r_end) AT TIME ZONE 'Africa/Johannesburg')) THEN
    r_work := false; r_src := 'leave';
  END IF;
  RETURN QUERY SELECT r_work, r_start, r_end, r_src;
END $$;
REVOKE EXECUTE ON FUNCTION public.staff_work_window(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_work_window(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_home_base(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.profiles WHERE id = p_profile_id;
  IF NOT (auth.uid() IS NULL OR p_profile_id = auth.uid() OR public.rh_ops_ok(v_company)) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.staff_home_bases h WHERE h.profile_id = p_profile_id
    AND (nullif(trim(h.address),'') IS NOT NULL OR h.lat IS NOT NULL));
END $$;
REVOKE EXECUTE ON FUNCTION public.has_home_base(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_home_base(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._person_bookings(p_profile_id uuid, p_date date)
RETURNS TABLE(start_time time, end_time time, customer_name text, job_id uuid, lead_id uuid, agent_id uuid, schedule_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s.start_time,
         COALESCE(s.end_time, (s.start_time + make_interval(mins => public.default_booking_minutes(COALESCE(j.job_type, l.service_type, l.primary_intent::text))))::time),
         COALESCE(l.customer_name, j.title), s.job_id, s.lead_id, s.agent_id, s.id
  FROM public.job_schedules s
  LEFT JOIN public.jobs j ON j.id = s.job_id
  LEFT JOIN public.leads l ON l.id = s.lead_id
  WHERE s.agent_id = p_profile_id AND s.scheduled_date = p_date AND s.start_time IS NOT NULL
    AND lower(coalesce(j.status,'')) NOT IN ('cancelled','canceled','completed')
    AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled')
    AND l.deleted_at IS NULL
    -- lead-level row hidden when a job row exists for the same lead/person/day
    AND NOT (s.job_id IS NULL AND EXISTS (SELECT 1 FROM public.job_schedules s2
             WHERE s2.job_id IS NOT NULL AND s2.lead_id = s.lead_id AND s2.agent_id = s.agent_id AND s2.scheduled_date = s.scheduled_date))
  UNION ALL
  SELECT l.scheduled_time,
         (l.scheduled_time + make_interval(mins => COALESCE(l.estimated_duration_minutes, 60)))::time,
         l.customer_name, NULL::uuid, l.id, l.assigned_agent_id, NULL::uuid
  FROM public.leads l
  WHERE l.assigned_agent_id = p_profile_id AND l.scheduled_date = p_date AND l.scheduled_time IS NOT NULL
    AND l.deleted_at IS NULL AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled')
    AND NOT EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = l.id)
  UNION ALL
  SELECT (GREATEST(b.starts_at, (p_date::timestamp) AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')::time,
         CASE WHEN b.ends_at >= ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg') THEN time '23:59:59'
              ELSE (b.ends_at AT TIME ZONE 'Africa/Johannesburg')::time END,
         CASE WHEN b.kind = 'leave' THEN 'Off' ELSE 'Blocked' END,
         NULL::uuid, NULL::uuid, b.profile_id, NULL::uuid
  FROM public.staff_blocked_time b
  WHERE b.profile_id = p_profile_id AND b.archived_at IS NULL
    AND b.starts_at < ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND b.ends_at > ((p_date::timestamp) AT TIME ZONE 'Africa/Johannesburg');
$$;
REVOKE ALL ON FUNCTION public._person_bookings(uuid, date) FROM PUBLIC, anon, authenticated;

/* ROLLBACK
DROP FUNCTION IF EXISTS public.staff_work_window(uuid, date);
DROP FUNCTION IF EXISTS public.has_home_base(uuid);
DROP TABLE IF EXISTS public.staff_home_bases;
DROP TABLE IF EXISTS public.staff_blocked_time;
DROP TABLE IF EXISTS public.staff_work_hours;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS office_address, DROP COLUMN IF EXISTS office_lat,
  DROP COLUMN IF EXISTS office_lng, DROP COLUMN IF EXISTS start_from;
ALTER TABLE public.companies DROP COLUMN IF EXISTS work_days, DROP COLUMN IF EXISTS work_start,
  DROP COLUMN IF EXISTS work_end, DROP COLUMN IF EXISTS office_address, DROP COLUMN IF EXISTS office_lat,
  DROP COLUMN IF EXISTS office_lng;
CREATE OR REPLACE FUNCTION public._person_bookings(p_profile_id uuid, p_date date)
RETURNS TABLE(start_time time, end_time time, customer_name text, job_id uuid, lead_id uuid, agent_id uuid, schedule_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT s.start_time,
         COALESCE(s.end_time, (s.start_time + make_interval(mins => public.default_booking_minutes(COALESCE(j.job_type, l.service_type, l.primary_intent::text))))::time),
         COALESCE(l.customer_name, j.title), s.job_id, s.lead_id, s.agent_id, s.id
  FROM public.job_schedules s
  LEFT JOIN public.jobs j ON j.id = s.job_id
  LEFT JOIN public.leads l ON l.id = s.lead_id
  WHERE s.agent_id = p_profile_id AND s.scheduled_date = p_date AND s.start_time IS NOT NULL
    AND lower(coalesce(j.status,'')) NOT IN ('cancelled','canceled','completed')
    AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled')
    AND l.deleted_at IS NULL
    AND NOT (s.job_id IS NULL AND EXISTS (SELECT 1 FROM public.job_schedules s2
             WHERE s2.job_id IS NOT NULL AND s2.lead_id = s.lead_id AND s2.agent_id = s.agent_id AND s2.scheduled_date = s.scheduled_date))
  UNION ALL
  SELECT l.scheduled_time,
         (l.scheduled_time + make_interval(mins => COALESCE(l.estimated_duration_minutes, 60)))::time,
         l.customer_name, NULL::uuid, l.id, l.assigned_agent_id, NULL::uuid
  FROM public.leads l
  WHERE l.assigned_agent_id = p_profile_id AND l.scheduled_date = p_date AND l.scheduled_time IS NOT NULL
    AND l.deleted_at IS NULL AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled')
    AND NOT EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = l.id);
$fn$;
REVOKE ALL ON FUNCTION public._person_bookings(uuid, date) FROM PUBLIC, anon, authenticated;
*/