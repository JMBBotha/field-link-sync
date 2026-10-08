-- S1.4: normalise legacy assignment values to the allowed CHECK values
CREATE OR REPLACE FUNCTION public.normalize_assignment_values()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.assignment_type IN ('primary','manual','offer','auto_geo') THEN NEW.assignment_type := 'internal'; END IF;
  IF NEW.status = 'assigned' THEN NEW.status := 'accepted'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS normalize_assignment_values ON public.assignments;
CREATE TRIGGER normalize_assignment_values BEFORE INSERT OR UPDATE ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.normalize_assignment_values();

-- Defaults mirrored from src/lib/schedulingDefaults.ts
CREATE OR REPLACE FUNCTION public.default_booking_minutes(p_kind text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN lower(coalesce(p_kind,'')) LIKE '%install%' THEN 210
    WHEN lower(coalesce(p_kind,'')) LIKE '%repair%' THEN 150
    WHEN lower(coalesce(p_kind,'')) IN ('sales','quote','sales_visit','quote_visit','consultation') THEN 60
    WHEN lower(coalesce(p_kind,'')) LIKE '%service%' OR lower(coalesce(p_kind,'')) LIKE '%maint%' THEN 120
    ELSE 60 END;
$$;

-- All bookings of one person on one day (deduped like the calendar)
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
    AND NOT EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = l.id);
$$;
REVOKE ALL ON FUNCTION public._person_bookings(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.booking_clashes(
  p_profile_id uuid, p_date date, p_start time, p_end time,
  p_exclude_job_id uuid DEFAULT NULL, p_exclude_lead_id uuid DEFAULT NULL)
RETURNS TABLE(kind text, start_time time, end_time time, label text, job_id uuid, lead_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_admin boolean;
BEGIN
  SELECT company_id INTO v_company FROM public.profiles WHERE id = p_profile_id;
  IF auth.uid() IS NOT NULL AND NOT (public.rh_ops_ok(v_company) OR p_profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  v_admin := auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin');
  RETURN QUERY
  SELECT CASE WHEN b.start_time < p_end AND b.end_time > p_start THEN 'overlap' ELSE 'tight' END,
         b.start_time, b.end_time,
         CASE WHEN v_admin OR b.agent_id = auth.uid() THEN COALESCE(b.customer_name, 'Booking') ELSE 'Busy' END,
         b.job_id, b.lead_id
  FROM public._person_bookings(p_profile_id, p_date) b
  WHERE (p_exclude_job_id IS NULL OR b.job_id IS DISTINCT FROM p_exclude_job_id)
    AND (p_exclude_lead_id IS NULL OR b.lead_id IS DISTINCT FROM p_exclude_lead_id)
    AND (
      (b.start_time < p_end AND b.end_time > p_start)
      OR (b.end_time <= p_start AND p_start - b.end_time < interval '30 minutes')
      OR (b.start_time >= p_end AND b.start_time - p_end < interval '30 minutes')
    )
  ORDER BY b.start_time;
END $$;
GRANT EXECUTE ON FUNCTION public.booking_clashes(uuid, date, time, time, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_double_bookings(p_from date, p_to date)
RETURNS TABLE(profile_id uuid, full_name text, booking_date date,
  a_start time, a_end time, a_label text, b_start time, b_end time, b_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid := public.caller_company_id(); v_admin boolean := public.has_role(auth.uid(), 'admin');
BEGIN
  IF auth.uid() IS NULL OR NOT public.rh_ops_ok(v_company) THEN RETURN; END IF;
  RETURN QUERY
  WITH people AS (
    SELECT DISTINCT s.agent_id AS pid, s.scheduled_date AS d FROM public.job_schedules s
      JOIN public.profiles p ON p.id = s.agent_id AND p.company_id = v_company
     WHERE s.scheduled_date BETWEEN p_from AND p_to
    UNION
    SELECT DISTINCT l.assigned_agent_id, l.scheduled_date FROM public.leads l
      JOIN public.profiles p ON p.id = l.assigned_agent_id AND p.company_id = v_company
     WHERE l.scheduled_date BETWEEN p_from AND p_to AND l.scheduled_time IS NOT NULL
  ), b AS (
    SELECT pe.pid, pe.d, x.*, row_number() OVER (PARTITION BY pe.pid, pe.d ORDER BY x.start_time, x.job_id, x.lead_id) rn
    FROM people pe, LATERAL public._person_bookings(pe.pid, pe.d) x
  )
  SELECT a.pid, p.full_name, a.d, a.start_time, a.end_time,
         CASE WHEN v_admin OR a.pid = auth.uid() THEN COALESCE(a.customer_name,'Booking') ELSE 'Busy' END,
         c.start_time, c.end_time,
         CASE WHEN v_admin OR c.pid = auth.uid() THEN COALESCE(c.customer_name,'Booking') ELSE 'Busy' END
  FROM b a JOIN b c ON c.pid = a.pid AND c.d = a.d AND c.rn > a.rn
   AND a.start_time < c.end_time AND c.start_time < a.end_time
  JOIN public.profiles p ON p.id = a.pid
  ORDER BY a.d, p.full_name, a.start_time;
END $$;
GRANT EXECUTE ON FUNCTION public.open_double_bookings(date, date) TO authenticated, service_role;

-- S2.8: robots skip people already booked at the lead's slot
CREATE OR REPLACE FUNCTION public.find_dispatch_candidates(p_lead_id uuid, p_role text, p_radius_km numeric DEFAULT 40, p_skill text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH l AS (SELECT id, location, company_id, scheduled_date, scheduled_time,
                    (scheduled_time + make_interval(mins => COALESCE(estimated_duration_minutes,
                       public.default_booking_minutes(CASE WHEN primary_intent::text = 'sales' THEN 'sales' ELSE service_type END))))::time AS end_time
             FROM public.leads WHERE id = p_lead_id AND public.rh_ops_ok(company_id) /*rh*/)
  SELECT p.id, p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
    AND p.dispatch_role = p_role
    AND p.home_location IS NOT NULL
    AND l.location IS NOT NULL
    AND (l.company_id IS NULL OR p.company_id = l.company_id OR p.participant_type IN ('independent_sales','independent_tech'))
    AND ST_DWithin(p.home_location, l.location, p_radius_km * 1000)
    AND (p_skill IS NULL OR p_skill = ANY(COALESCE(p.skills, ARRAY[]::text[])))
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
    AND (l.scheduled_date IS NULL OR l.scheduled_time IS NULL OR NOT EXISTS (
      SELECT 1 FROM public._person_bookings(p.id, l.scheduled_date) b
      WHERE b.lead_id IS DISTINCT FROM l.id AND b.start_time < l.end_time AND b.end_time > l.scheduled_time))
  ORDER BY distance_km ASC;
$function$;

CREATE OR REPLACE FUNCTION public.find_dispatch_candidates_multi(p_lead_id uuid, p_role text, p_radius_km numeric, p_skills text[] DEFAULT NULL::text[])
 RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH l AS (SELECT id, location, company_id, scheduled_date, scheduled_time,
                    (scheduled_time + make_interval(mins => COALESCE(estimated_duration_minutes,
                       public.default_booking_minutes(CASE WHEN primary_intent::text = 'sales' THEN 'sales' ELSE service_type END))))::time AS end_time
             FROM public.leads WHERE id = p_lead_id AND public.rh_ops_ok(company_id) /*rh*/)
  SELECT p.id, p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
    AND p.dispatch_role = p_role
    AND p.home_location IS NOT NULL
    AND l.location IS NOT NULL
    AND (l.company_id IS NULL OR p.company_id = l.company_id OR p.participant_type IN ('independent_sales','independent_tech'))
    AND ST_DWithin(p.home_location, l.location, p_radius_km * 1000)
    AND (p_skills IS NULL OR array_length(p_skills, 1) IS NULL OR COALESCE(p.skills, ARRAY[]::text[]) && p_skills)
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
    AND (l.scheduled_date IS NULL OR l.scheduled_time IS NULL OR NOT EXISTS (
      SELECT 1 FROM public._person_bookings(p.id, l.scheduled_date) b
      WHERE b.lead_id IS DISTINCT FROM l.id AND b.start_time < l.end_time AND b.end_time > l.scheduled_time))
  ORDER BY distance_km ASC;
$function$;