-- Auto presence (Johan t1925u/t1927u): auto "On the way", geofence check-in (150 m, 2 min dwell),
-- check-out (leave 200 m, 4 min dwell) for techs (jobs) and salespeople (booked site visits).
-- Only inside each target's window (same window as job_tech_location). Visit records = proof.
-- Idempotent. Rollback: rollback_presence.sql.

CREATE TABLE IF NOT EXISTS public.presence_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('job','sales_visit')),
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  visit_date date NOT NULL,
  en_route_at timestamptz, arrived_at timestamptz, left_at timestamptz,
  inside_since timestamptz, outside_since timestamptz,
  last_distance_m integer, last_fix_at timestamptz,
  arrived_source text, left_source text, en_route_source text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS presence_visits_target_day
  ON public.presence_visits (user_id, kind, COALESCE(job_id, lead_id), visit_date);
CREATE INDEX IF NOT EXISTS presence_visits_company_day ON public.presence_visits (company_id, visit_date);
ALTER TABLE public.presence_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS presence_select ON public.presence_visits;
CREATE POLICY presence_select ON public.presence_visits FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.fl_is_company_admin(auth.uid(), company_id)
  OR (job_id IS NOT NULL AND public.fl_is_job_salesperson(auth.uid(), job_id)));
-- No insert/update/delete policies: writes only through the SECURITY DEFINER RPCs below.

-- Sales visit window: 90 min before the booked time until booked time + duration (default 60) + 1 h.
CREATE OR REPLACE FUNCTION public.lead_visit_window(p_lead uuid)
RETURNS TABLE(window_start timestamptz, window_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s - interval '90 minutes', s + make_interval(mins => COALESCE(l.estimated_duration_minutes, 60)) + interval '1 hour'
  FROM public.leads l CROSS JOIN LATERAL (SELECT ((l.scheduled_date + l.scheduled_time) AT TIME ZONE 'Africa/Johannesburg') s) x
  WHERE l.id = p_lead AND l.scheduled_date IS NOT NULL AND l.scheduled_time IS NOT NULL;
$$;

-- Everything the caller should be tracked for right now (tech jobs + own sales visits).
CREATE OR REPLACE FUNCTION public.my_presence_targets()
RETURNS TABLE(kind text, job_id uuid, lead_id uuid, title text, lat numeric, lng numeric, window_start timestamptz, window_end timestamptz, company_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'job', j.id, NULL::uuid, j.title,
         COALESCE(j.lat, cl.latitude), COALESCE(j.lng, cl.longitude), w.window_start, w.window_end, j.company_id
  FROM public.assignments a JOIN public.jobs j ON j.id = a.job_id
  LEFT JOIN public.customer_locations cl ON cl.id = j.location_id
  CROSS JOIN LATERAL public.job_location_window(j.id) w
  WHERE a.profile_id = auth.uid() AND COALESCE(a.status,'') NOT IN ('declined','cancelled','rejected')
    AND j.status NOT IN ('completed','cancelled')
    AND j.scheduled_for > now() - interval '14 days' AND j.scheduled_for < now() + interval '1 day'
    AND now() >= w.window_start AND now() < w.window_end
  UNION ALL
  SELECT 'sales_visit', NULL, l.id, COALESCE(NULLIF(l.customer_name,''), 'Site visit'),
         l.latitude, l.longitude, w.window_start, w.window_end, l.company_id
  FROM public.leads l CROSS JOIN LATERAL public.lead_visit_window(l.id) w
  WHERE l.assigned_agent_id = auth.uid() AND l.deleted_at IS NULL AND l.closed_at IS NULL
    AND l.company_id = public.get_user_company_id(auth.uid())
    AND l.scheduled_date BETWEEN current_date - 1 AND current_date + 1
    AND now() >= w.window_start AND now() < w.window_end;
$$;

CREATE OR REPLACE FUNCTION public._presence_notify_admins(p_company uuid, p_title text, p_body text, p_related uuid, p_meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT cm.user_id, 'field_presence', p_title, p_body, p_related, p_meta
  FROM public.company_members cm WHERE cm.company_id = p_company AND cm.role = 'admin' AND cm.user_id <> auth.uid();
$$;

-- Called by the phone with each GPS fix. Stores the fix and runs the geofence state machine.
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
      v_out := v_out || jsonb_build_object('id', v.id, 'target', COALESCE(t.job_id, t.lead_id), 'kind', t.kind, 'title', t.title, 'distance_m', NULL);
      CONTINUE;
    END IF;
    d := round(public.calculate_distance_km(p_lat, p_lng, t.lat, t.lng) * 1000);
    -- On the way: 300 m closer since the previous fix while still outside the fence.
    IF v.en_route_at IS NULL AND v.arrived_at IS NULL AND d > 150 AND v.last_distance_m IS NOT NULL AND v.last_distance_m - d >= 300 THEN
      UPDATE public.presence_visits SET en_route_at = now(), en_route_source = 'auto' WHERE id = v.id;
      IF t.kind = 'job' THEN
        UPDATE public.assignments SET status = 'accepted' WHERE job_id = t.job_id AND profile_id = v_uid AND status = 'proposed';
        UPDATE public.jobs SET status = 'dispatched' WHERE id = t.job_id AND status = 'scheduled';
      END IF;
    END IF;
    IF d <= 150 THEN
      UPDATE public.presence_visits SET outside_since = NULL,
        inside_since = CASE WHEN arrived_at IS NULL THEN COALESCE(inside_since, now()) ELSE inside_since END WHERE id = v.id;
      SELECT * INTO v FROM public.presence_visits WHERE id = v.id;
      IF v.arrived_at IS NULL AND now() - v.inside_since >= interval '2 minutes' THEN
        UPDATE public.presence_visits SET arrived_at = v.inside_since, arrived_source = 'auto',
          en_route_at = COALESCE(en_route_at, v.inside_since), en_route_source = COALESCE(en_route_source, 'auto') WHERE id = v.id;
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
      'en_route_at', v.en_route_at, 'arrived_at', v.arrived_at, 'left_at', v.left_at, 'window_end', t.window_end);
  END LOOP;
  IF jsonb_array_length(v_out) > 0 THEN
    UPDATE public.agent_locations SET latitude = p_lat, longitude = p_lng, last_updated = now() WHERE agent_id = v_uid;
    IF NOT FOUND THEN
      INSERT INTO public.agent_locations (agent_id, latitude, longitude, is_available, last_updated) VALUES (v_uid, p_lat, p_lng, false, now());
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'targets', v_out);
END $$;

-- Manual fallback / override (only for the caller's own open target).
CREATE OR REPLACE FUNCTION public.presence_manual(p_kind text, p_target uuid, p_event text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); t record; v_d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  SELECT * INTO t FROM public.my_presence_targets() x WHERE x.kind = p_kind AND COALESCE(x.job_id, x.lead_id) = p_target LIMIT 1;
  IF t.kind IS NULL THEN RAISE EXCEPTION 'This visit is not open for check-in right now'; END IF;
  INSERT INTO public.presence_visits (company_id, user_id, kind, job_id, lead_id, visit_date)
  VALUES (t.company_id, v_uid, t.kind, t.job_id, t.lead_id, v_d)
  ON CONFLICT (user_id, kind, COALESCE(job_id, lead_id), visit_date) DO NOTHING;
  UPDATE public.presence_visits SET
    en_route_at = CASE WHEN p_event IN ('en_route','arrived') THEN COALESCE(en_route_at, now()) ELSE en_route_at END,
    en_route_source = CASE WHEN p_event IN ('en_route','arrived') AND en_route_at IS NULL THEN 'manual' ELSE en_route_source END,
    arrived_at = CASE WHEN p_event = 'arrived' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
    arrived_source = CASE WHEN p_event = 'arrived' AND arrived_at IS NULL THEN 'manual' ELSE arrived_source END,
    left_at = CASE WHEN p_event = 'left' THEN now() ELSE left_at END,
    left_source = CASE WHEN p_event = 'left' THEN 'manual' ELSE left_source END,
    updated_at = now()
  WHERE user_id = v_uid AND kind = t.kind AND COALESCE(job_id, lead_id) = p_target AND visit_date = v_d;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Admin live board: today's presence for the admin's company.
CREATE OR REPLACE FUNCTION public.presence_board()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN NOT public.fl_is_company_admin(auth.uid(), public.get_user_company_id(auth.uid())) THEN '[]'::jsonb ELSE
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'job_id', v.job_id, 'lead_id', v.lead_id,
     'name', COALESCE(NULLIF(trim(p.full_name),''),'Team member'),
     'title', COALESCE(j.title, l.customer_name), 'en_route_at', v.en_route_at, 'arrived_at', v.arrived_at, 'left_at', v.left_at,
     'arrived_source', v.arrived_source, 'distance_m', v.last_distance_m, 'last_fix_at', v.last_fix_at) ORDER BY v.updated_at DESC)
    FROM public.presence_visits v JOIN public.profiles p ON p.id = v.user_id
    LEFT JOIN public.jobs j ON j.id = v.job_id LEFT JOIN public.leads l ON l.id = v.lead_id
    WHERE v.company_id = public.get_user_company_id(auth.uid())
      AND v.visit_date = (now() AT TIME ZONE 'Africa/Johannesburg')::date), '[]'::jsonb) END;
$$;

REVOKE ALL ON FUNCTION public.lead_visit_window(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_presence_targets() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._presence_notify_admins(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_presence(numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.presence_manual(text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.presence_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_presence_targets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_presence(numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_manual(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_board() TO authenticated;
GRANT SELECT ON public.presence_visits TO authenticated;

-- Tech location block now reads auto presence (On site / Left site).
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
                     WHEN j.status = 'dispatched' OR j.en_route_at IS NOT NULL THEN 'on_the_way'
                     ELSE 'not_started' END,
      'shared', fresh)), '[]'::jsonb) INTO v_techs
    FROM public.assignments a
    JOIN public.profiles p ON p.id = a.profile_id AND p.company_id = j.company_id
    LEFT JOIN public.agent_locations l ON l.agent_id = a.profile_id
    LEFT JOIN public.presence_visits pv ON pv.kind = 'job' AND pv.job_id = j.id AND pv.user_id = a.profile_id
         AND pv.visit_date = (now() AT TIME ZONE 'Africa/Johannesburg')::date
    CROSS JOIN LATERAL (SELECT (l.last_updated IS NOT NULL AND l.last_updated >= w.window_start) AS fresh) f
    WHERE a.job_id = p_job_id AND COALESCE(a.status,'') NOT IN ('declined','cancelled','rejected');
  END IF;
  RETURN jsonb_build_object('allowed', true, 'in_window', v_in,
    'window_start', w.window_start, 'window_end', w.window_end, 'scheduled_start', w.sched_start,
    'job_lat', v_lat, 'job_lng', v_lng, 'job_status', j.status, 'techs', COALESCE(v_techs, '[]'::jsonb));
END $$;

