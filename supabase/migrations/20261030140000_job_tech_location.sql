-- Live tech location for the job's salesperson, only during the job window (POPIA).
-- Window: start = (today's job_schedules start for multi-day jobs, else jobs.scheduled_for) - 90 min.
-- End   = completed_at/cancel closes it; else schedule end_time / scheduled_until + 1h;
--         else start + estimated_duration + 1h; else midnight (SAST) of the start day.
-- Idempotent. Rollback: rollback.sql (drops these functions).

CREATE OR REPLACE FUNCTION public.job_location_window(p_job_id uuid, p_at timestamptz DEFAULT now())
RETURNS TABLE(window_start timestamptz, window_end timestamptz, sched_start timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; s record; v_start timestamptz; v_end timestamptz;
  v_d date := (p_at AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.id IS NULL THEN RETURN; END IF;
  SELECT * INTO s FROM public.job_schedules WHERE job_id = p_job_id AND scheduled_date = v_d AND start_time IS NOT NULL
   ORDER BY start_time LIMIT 1;
  IF s.id IS NOT NULL THEN
    v_start := (s.scheduled_date + s.start_time) AT TIME ZONE 'Africa/Johannesburg';
    IF s.end_time IS NOT NULL THEN v_end := ((s.scheduled_date + s.end_time) AT TIME ZONE 'Africa/Johannesburg') + interval '1 hour'; END IF;
  ELSE
    v_start := j.scheduled_for;
    IF j.scheduled_until IS NOT NULL THEN v_end := j.scheduled_until + interval '1 hour';
    ELSIF j.estimated_duration IS NOT NULL THEN v_end := j.scheduled_for + j.estimated_duration + interval '1 hour'; END IF;
  END IF;
  IF v_start IS NULL THEN RETURN; END IF;
  IF v_end IS NULL OR v_end <= v_start THEN
    v_end := (((v_start AT TIME ZONE 'Africa/Johannesburg')::date + 1)::timestamp) AT TIME ZONE 'Africa/Johannesburg';
  END IF;
  IF j.status IN ('completed','cancelled') THEN v_end := LEAST(v_end, COALESCE(j.completed_at, j.updated_at, p_at)); END IF;
  RETURN QUERY SELECT v_start - interval '90 minutes', v_end, v_start;
END $$;

-- Is _uid this job's salesperson (or admin of its company)? Same rules as rep visibility (#57/#60).
CREATE OR REPLACE FUNCTION public.fl_is_job_salesperson(_uid uuid, _job uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j LEFT JOIN public.customers c ON c.id = j.customer_id
     WHERE j.id = _job AND j.company_id = public.get_user_company_id(_uid)
       AND ( public.fl_is_company_admin(_uid, j.company_id)
          OR ( public.is_sales_rep(_uid) AND (
                 public.rep_owns_job(_uid, j.id)
              OR c.owner_rep_id = _uid OR c.assigned_rep_id = _uid
              OR (c.id IS NOT NULL AND public.fl_rep_owns_customer(_uid, c.id, j.company_id))))));
$$;

CREATE OR REPLACE FUNCTION public.job_tech_location(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); j record; w record; v_in boolean; v_techs jsonb; v_lat numeric; v_lng numeric;
BEGIN
  IF NOT public.fl_is_job_salesperson(v_uid, p_job_id) THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  SELECT * INTO w FROM public.job_location_window(p_job_id);
  v_lat := j.lat; v_lng := j.lng;
  IF v_lat IS NULL AND j.location_id IS NOT NULL THEN
    SELECT latitude, longitude INTO v_lat, v_lng FROM public.customer_locations WHERE id = j.location_id;
  END IF;
  v_in := w.window_start IS NOT NULL AND now() >= w.window_start AND now() < w.window_end;
  IF v_in THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'tech_id', a.profile_id,
      'name', COALESCE(NULLIF(trim(p.full_name),''), 'Technician'),
      'lat', CASE WHEN fresh THEN l.latitude END,
      'lng', CASE WHEN fresh THEN l.longitude END,
      'last_updated', CASE WHEN fresh THEN l.last_updated END,
      'distance_km', CASE WHEN fresh AND v_lat IS NOT NULL THEN round(public.calculate_distance_km(l.latitude, l.longitude, v_lat, v_lng)::numeric, 1) END,
      'status', CASE WHEN j.status = 'in_progress' OR j.started_at IS NOT NULL THEN 'on_site'
                     WHEN j.status = 'dispatched' OR j.en_route_at IS NOT NULL THEN 'on_the_way'
                     ELSE 'not_started' END,
      'shared', fresh)), '[]'::jsonb) INTO v_techs
    FROM public.assignments a
    JOIN public.profiles p ON p.id = a.profile_id AND p.company_id = j.company_id
    LEFT JOIN public.agent_locations l ON l.agent_id = a.profile_id
    CROSS JOIN LATERAL (SELECT (l.last_updated IS NOT NULL AND l.last_updated >= w.window_start) AS fresh) f
    WHERE a.job_id = p_job_id AND COALESCE(a.status,'') NOT IN ('declined','cancelled','rejected');
  END IF;
  RETURN jsonb_build_object('allowed', true, 'in_window', v_in,
    'window_start', w.window_start, 'window_end', w.window_end, 'scheduled_start', w.sched_start,
    'job_lat', v_lat, 'job_lng', v_lng, 'job_status', j.status, 'techs', COALESCE(v_techs, '[]'::jsonb));
END $$;

-- Tech side: is the caller assigned to a job whose window is open now? (drives reporting + notice)
CREATE OR REPLACE FUNCTION public.my_location_share_jobs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('job_id', j.id, 'title', j.title, 'window_end', w.window_end, 'window_start', w.window_start)), '[]'::jsonb)
  FROM public.assignments a JOIN public.jobs j ON j.id = a.job_id
  CROSS JOIN LATERAL public.job_location_window(j.id) w
  WHERE a.profile_id = auth.uid() AND COALESCE(a.status,'') NOT IN ('declined','cancelled','rejected')
    AND j.status NOT IN ('completed','cancelled')
    AND j.scheduled_for > now() - interval '14 days' AND j.scheduled_for < now() + interval '1 day'
    AND now() >= w.window_start AND now() < w.window_end;
$$;

REVOKE ALL ON FUNCTION public.job_location_window(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fl_is_job_salesperson(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_tech_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_location_share_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_tech_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_location_share_jobs() TO authenticated;
