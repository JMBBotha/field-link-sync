-- Start trip: "On the way" is only ever set by the person tapping Start trip (presence_manual 'start_trip').
-- Movement toward a job now only nudges (in-app). Auto check-in/out unchanged. Cancel trip within 5 min.
-- Salesperson sees the tech's location only once the trip is started (or on site).
ALTER TABLE public.presence_visits ADD COLUMN IF NOT EXISTS nudged_at timestamptz;

CREATE OR REPLACE FUNCTION public.report_presence(p_lat numeric, p_lng numeric, p_accuracy numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); t record; v record; d integer; v_d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_out jsonb := '[]'::jsonb; v_name text; v_good boolean := COALESCE(p_accuracy, 0) <= 200;
BEGIN
  IF v_uid IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT COALESCE(NULLIF(trim(full_name),''),'Team member') INTO v_name FROM public.profiles WHERE id = v_uid;
  FOR t IN SELECT * FROM public.my_presence_targets() LOOP
    INSERT INTO public.presence_visits (company_id, user_id, kind, job_id, lead_id, visit_date)
    VALUES (t.company_id, v_uid, t.kind, t.job_id, t.lead_id, v_d)
    ON CONFLICT (user_id, kind, COALESCE(job_id, lead_id), visit_date) DO NOTHING;
    SELECT * INTO v FROM public.presence_visits WHERE user_id = v_uid AND kind = t.kind
      AND COALESCE(job_id, lead_id) = COALESCE(t.job_id, t.lead_id) AND visit_date = v_d FOR UPDATE;
    IF t.lat IS NULL OR NOT v_good THEN
      UPDATE public.presence_visits SET last_fix_at = now(), updated_at = now() WHERE id = v.id;
      v_out := v_out || jsonb_build_object('id', v.id, 'target', COALESCE(t.job_id, t.lead_id), 'kind', t.kind, 'title', t.title, 'distance_m', NULL,
        'en_route_at', v.en_route_at, 'en_route_source', v.en_route_source, 'arrived_at', v.arrived_at, 'left_at', v.left_at, 'window_end', t.window_end);
      CONTINUE;
    END IF;
    d := round(public.calculate_distance_km(p_lat, p_lng, t.lat, t.lng) * 1000);
    -- Never mark On the way from movement. If they head 300 m+ closer without tapping Start trip, nudge once (in-app only).
    IF v.en_route_at IS NULL AND v.arrived_at IS NULL AND v.nudged_at IS NULL AND d > 150
       AND v.last_distance_m IS NOT NULL AND v.last_distance_m - d >= 300 THEN
      UPDATE public.presence_visits SET nudged_at = now() WHERE id = v.id;
      INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
      VALUES (v_uid, 'trip_nudge', 'Heading to ' || COALESCE(t.title, 'your next visit') || '?', 'Tap Start trip so the office knows you are on the way.',
        COALESCE(t.job_id, t.lead_id), jsonb_build_object('kind', t.kind, 'job_id', t.job_id, 'lead_id', t.lead_id));
    END IF;
    IF d <= 150 THEN
      UPDATE public.presence_visits SET outside_since = NULL,
        inside_since = CASE WHEN arrived_at IS NULL THEN COALESCE(inside_since, now()) ELSE inside_since END WHERE id = v.id;
      SELECT * INTO v FROM public.presence_visits WHERE id = v.id;
      IF v.arrived_at IS NULL AND now() - v.inside_since >= interval '2 minutes' THEN
        UPDATE public.presence_visits SET arrived_at = v.inside_since, arrived_source = 'auto' WHERE id = v.id;
        IF t.kind = 'job' THEN
          UPDATE public.jobs SET status = 'in_progress' WHERE id = t.job_id AND status IN ('scheduled','dispatched');
        END IF;
        PERFORM public._presence_notify_admins(t.company_id, v_name || ' arrived', COALESCE(t.title,'') || ' · auto check-in',
          COALESCE(t.job_id, t.lead_id), jsonb_build_object('kind', t.kind, 'job_id', t.job_id, 'lead_id', t.lead_id, 'event', 'arrived'));
      END IF;
    ELSIF d > 200 THEN
      UPDATE public.presence_visits SET inside_since = CASE WHEN arrived_at IS NULL THEN NULL ELSE inside_since END,
        outside_since = CASE WHEN arrived_at IS NOT NULL AND left_at IS NULL THEN COALESCE(outside_since, now()) ELSE outside_since END WHERE id = v.id;
      SELECT * INTO v FROM public.presence_visits WHERE id = v.id;
      IF v.arrived_at IS NOT NULL AND v.left_at IS NULL AND now() - v.outside_since >= interval '4 minutes' THEN
        UPDATE public.presence_visits SET left_at = v.outside_since, left_source = 'auto' WHERE id = v.id;
        PERFORM public._presence_notify_admins(t.company_id, v_name || ' left site', COALESCE(t.title,'') || ' · auto check-out',
          COALESCE(t.job_id, t.lead_id), jsonb_build_object('kind', t.kind, 'job_id', t.job_id, 'lead_id', t.lead_id, 'event', 'left'));
      END IF;
    END IF;
    UPDATE public.presence_visits SET last_distance_m = d, last_fix_at = now(), updated_at = now() WHERE id = v.id;
    SELECT * INTO v FROM public.presence_visits WHERE id = v.id;
    v_out := v_out || jsonb_build_object('id', v.id, 'target', COALESCE(t.job_id, t.lead_id), 'kind', t.kind, 'title', t.title, 'distance_m', d,
      'en_route_at', v.en_route_at, 'en_route_source', v.en_route_source, 'nudge', (v.nudged_at IS NOT NULL AND v.en_route_at IS NULL AND v.arrived_at IS NULL), 'arrived_at', v.arrived_at, 'left_at', v.left_at, 'window_end', t.window_end);
  END LOOP;
  IF jsonb_array_length(v_out) > 0 THEN
    UPDATE public.agent_locations SET latitude = p_lat, longitude = p_lng, last_updated = now() WHERE agent_id = v_uid;
    IF NOT FOUND THEN
      INSERT INTO public.agent_locations (agent_id, latitude, longitude, is_available, last_updated) VALUES (v_uid, p_lat, p_lng, false, now());
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'targets', v_out);
END $$;


CREATE OR REPLACE FUNCTION public.presence_manual(p_kind text, p_target uuid, p_event text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); t record; v record; v_d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v_name text;
BEGIN
  IF p_event = 'start_trip' THEN p_event := 'en_route'; END IF;
  IF p_event NOT IN ('en_route','arrived','left','cancel_trip') THEN RAISE EXCEPTION 'Unknown event'; END IF;
  SELECT * INTO t FROM public.my_presence_targets() x WHERE x.kind = p_kind AND COALESCE(x.job_id, x.lead_id) = p_target LIMIT 1;
  IF t.kind IS NULL THEN RAISE EXCEPTION 'This visit is not open right now'; END IF;
  SELECT COALESCE(NULLIF(trim(full_name),''),'Team member') INTO v_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.presence_visits (company_id, user_id, kind, job_id, lead_id, visit_date)
  VALUES (t.company_id, v_uid, t.kind, t.job_id, t.lead_id, v_d)
  ON CONFLICT (user_id, kind, COALESCE(job_id, lead_id), visit_date) DO NOTHING;
  SELECT * INTO v FROM public.presence_visits WHERE user_id = v_uid AND kind = t.kind
    AND COALESCE(job_id, lead_id) = p_target AND visit_date = v_d FOR UPDATE;

  IF p_event = 'cancel_trip' THEN
    IF v.en_route_at IS NULL OR v.arrived_at IS NOT NULL OR now() - v.en_route_at > interval '5 minutes' THEN
      RAISE EXCEPTION 'Trip can only be cancelled within 5 minutes of starting it';
    END IF;
    UPDATE public.presence_visits SET en_route_at = NULL, en_route_source = NULL, nudged_at = NULL, updated_at = now() WHERE id = v.id;
    IF t.kind = 'job' THEN
      UPDATE public.jobs SET status = 'scheduled', en_route_at = NULL WHERE id = t.job_id AND status = 'dispatched';
      DELETE FROM public.notifications WHERE type = 'field_presence' AND related_id = p_target
        AND metadata->>'event' = 'en_route' AND metadata->>'by' = v_uid::text AND created_at >= v.en_route_at;
    ELSE
      DELETE FROM public.notifications WHERE type = 'field_presence' AND related_id = p_target
        AND metadata->>'event' = 'en_route' AND metadata->>'by' = v_uid::text AND created_at >= v.en_route_at;
    END IF;
    RETURN jsonb_build_object('ok', true, 'cancelled', true);
  END IF;

  IF p_event = 'en_route' AND v.en_route_at IS NULL AND v.arrived_at IS NULL THEN
    UPDATE public.presence_visits SET en_route_at = now(), en_route_source = 'manual', updated_at = now() WHERE id = v.id;
    IF t.kind = 'job' THEN
      UPDATE public.assignments SET status = 'accepted' WHERE job_id = t.job_id AND profile_id = v_uid AND status = 'proposed';
      UPDATE public.jobs SET status = 'dispatched' WHERE id = t.job_id AND status = 'scheduled';
    END IF;
    PERFORM public._presence_notify_admins(t.company_id, v_name || ' is on the way', COALESCE(t.title,'') || ' · trip started',
      p_target, jsonb_build_object('kind', t.kind, 'job_id', t.job_id, 'lead_id', t.lead_id, 'event', 'en_route', 'by', v_uid));
  ELSIF p_event = 'arrived' THEN
    UPDATE public.presence_visits SET arrived_at = COALESCE(arrived_at, now()),
      arrived_source = CASE WHEN arrived_at IS NULL THEN 'manual' ELSE arrived_source END, updated_at = now() WHERE id = v.id;
    IF t.kind = 'job' THEN UPDATE public.jobs SET status = 'in_progress' WHERE id = t.job_id AND status IN ('scheduled','dispatched'); END IF;
  ELSIF p_event = 'left' THEN
    UPDATE public.presence_visits SET left_at = now(), left_source = 'manual', updated_at = now() WHERE id = v.id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.presence_manual(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_manual(text, uuid, text) TO authenticated;

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
      'arrived_at', pv.arrived_at, 'left_at', pv.left_at, 'en_route_at', pv.en_route_at,
      'status', CASE WHEN pv.left_at IS NOT NULL THEN 'left_site'
                     WHEN pv.arrived_at IS NOT NULL THEN 'on_site'
                     WHEN pv.en_route_at IS NOT NULL THEN 'on_the_way'
                     WHEN j.status = 'in_progress' OR j.started_at IS NOT NULL THEN 'on_site'
                     WHEN j.status = 'dispatched' THEN 'on_the_way'
                     ELSE 'not_started' END,
      'shared', fresh)), '[]'::jsonb) INTO v_techs
    FROM public.assignments a
    JOIN public.profiles p ON p.id = a.profile_id AND p.company_id = j.company_id
    LEFT JOIN public.agent_locations l ON l.agent_id = a.profile_id
    LEFT JOIN public.presence_visits pv ON pv.kind = 'job' AND pv.job_id = j.id AND pv.user_id = a.profile_id
         AND pv.visit_date = (now() AT TIME ZONE 'Africa/Johannesburg')::date
    CROSS JOIN LATERAL (SELECT (l.last_updated IS NOT NULL AND l.last_updated >= w.window_start
         AND (pv.en_route_at IS NOT NULL OR pv.arrived_at IS NOT NULL OR j.status IN ('dispatched','in_progress'))) AS fresh) f
    WHERE a.job_id = p_job_id AND COALESCE(a.status,'') NOT IN ('declined','cancelled','rejected');
  END IF;
  RETURN jsonb_build_object('allowed', true, 'in_window', v_in,
    'window_start', w.window_start, 'window_end', w.window_end, 'scheduled_start', w.sched_start,
    'job_lat', v_lat, 'job_lng', v_lng, 'job_status', j.status, 'techs', COALESCE(v_techs, '[]'::jsonb));
END $$;

