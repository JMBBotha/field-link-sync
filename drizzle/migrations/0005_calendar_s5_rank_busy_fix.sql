-- Calendar S5 fix: busy never shown as free; 30-min buffer around blocked time; Booked/Blocked/Off wording; 'no location'. Functions only; no data rows.

CREATE OR REPLACE FUNCTION public._slot_fits(p_b jsonb, p_ws int, p_we int, p_s int, p_m int)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_s >= p_ws AND p_s + p_m <= p_we
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_b,'[]'::jsonb)) x
      WHERE p_s < (x->>'e')::int + 30
        AND p_s + p_m + 30 > (x->>'s')::int)
    AND (p_s + p_m + 30 <= p_we OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_b,'[]'::jsonb)) x
      WHERE (x->>'s')::int >= p_s + p_m));
$$;

CREATE OR REPLACE FUNCTION public._first_fit(p_b jsonb, p_ws int, p_we int, p_after int, p_m int)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT min(c) FROM (
    SELECT ((GREATEST(p_ws, p_after) + 4) / 5) * 5 AS c
    UNION
    SELECT (((x->>'e')::int + 30 + 4) / 5) * 5
    FROM jsonb_array_elements(COALESCE(p_b,'[]'::jsonb)) x
  ) q WHERE c >= p_after AND public._slot_fits(p_b, p_ws, p_we, c, p_m);
$$;

-- Core ranking. p_start NULL = suggestion mode (best_start = best fitting start).
CREATE OR REPLACE FUNCTION public._rank_core(p_lane text, p_date date, p_start time, p_minutes int,
  p_lat double precision, p_lng double precision, p_exclude_job uuid, p_exclude_lead uuid)
RETURNS TABLE(profile_id uuid, full_name text, tier int, status text, km numeric, reason text, next_free time,
  booked_minutes int, work_start time, work_end time, blocks jsonb, best_start time, sort_key numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_company uuid := public.caller_company_id(); v_full boolean;
  v_m int := GREATEST(COALESCE(p_minutes, 60), 5);
  v_req int := CASE WHEN p_start IS NULL THEN NULL ELSE (extract(epoch FROM p_start) / 60)::int END;
  p record; w record; b jsonb; ws int; we int; v_booked int;
  nb record; prev record; v_base_lat double precision; v_base_lng double precision; v_base_label text;
  v_fit boolean; v_cand int; v_next int; v_km numeric; v_back numeric; v_sort numeric; v_last boolean;
  v_clash text;
BEGIN
  v_full := v_uid IS NULL OR public.has_role(v_uid, 'admin')
    OR (public.is_ops_user(v_uid) AND COALESCE((SELECT dispatch_role FROM public.profiles WHERE id = v_uid), '') <> 'sales');

  FOR p IN
    SELECT pr.id, pr.full_name, pr.start_from, pr.home_lat, pr.home_lng, pr.office_lat, pr.office_lng,
           hb.lat AS hb_lat, hb.lng AS hb_lng, hb.address AS hb_addr, c.office_lat AS c_lat, c.office_lng AS c_lng
    FROM public.profiles pr
    LEFT JOIN public.staff_home_bases hb ON hb.profile_id = pr.id
    LEFT JOIN public.companies c ON c.id = pr.company_id
    WHERE pr.company_id = v_company AND COALESCE(pr.dispatch_active, false) AND pr.archived_at IS NULL
      AND (v_full OR pr.id = v_uid)
      AND CASE WHEN p_lane = 'sales'
            THEN pr.dispatch_role = 'sales' AND COALESCE(pr.participant_type,'') <> 'independent_tech'
            ELSE pr.dispatch_role = 'technician' OR pr.participant_type = 'independent_tech' END
  LOOP
    SELECT * INTO w FROM public.staff_work_window(p.id, p_date);
    ws := (extract(epoch FROM w.start_time) / 60)::int; we := (extract(epoch FROM w.end_time) / 60)::int;

    -- start base (never expose the home street address)
    v_base_lat := NULL; v_base_lng := NULL; v_base_label := NULL;
    IF COALESCE(p.start_from, 'home') = 'home' AND p.hb_lat IS NOT NULL THEN
      v_base_lat := p.hb_lat; v_base_lng := p.hb_lng;
      v_base_label := 'Home' || COALESCE(' (' || NULLIF(trim(split_part(p.hb_addr, ',', 2)), '') || ')', '');
    ELSIF COALESCE(p.start_from, '') <> 'office' AND p.home_lat IS NOT NULL THEN
      v_base_lat := p.home_lat; v_base_lng := p.home_lng; v_base_label := 'Home';
    ELSIF p.office_lat IS NOT NULL THEN
      v_base_lat := p.office_lat; v_base_lng := p.office_lng; v_base_label := 'Office';
    ELSIF p.c_lat IS NOT NULL THEN
      v_base_lat := p.c_lat; v_base_lng := p.c_lng; v_base_label := 'Office';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             's', (extract(epoch FROM q.start_time) / 60)::int,
             'e', (extract(epoch FROM q.end_time) / 60)::int,
             'pad', (q.job_id IS NOT NULL OR q.lead_id IS NOT NULL),
             'lat', q.lat, 'lng', q.lng, 'area', q.area,
             'label', CASE WHEN q.job_id IS NULL AND q.lead_id IS NULL THEN q.customer_name
                           WHEN v_full OR p.id = v_uid THEN COALESCE(q.customer_name, 'Booking') ELSE 'Busy' END,
             'km', CASE WHEN q.lat IS NULL OR p_lat IS NULL THEN NULL
                        ELSE round(public.calculate_distance_km(p_lat::numeric, p_lng::numeric, q.lat, q.lng), 1) END
           ) ORDER BY q.start_time), '[]'::jsonb)
      INTO b
    FROM (
      SELECT bk.*, COALESCE(l.latitude, j.lat, cu.latitude) AS lat, COALESCE(l.longitude, j.lng, cu.longitude) AS lng,
             COALESCE(NULLIF(trim(split_part(l.customer_address, ',', 2)), ''), cu.city) AS area
      FROM public._person_bookings(p.id, p_date) bk
      LEFT JOIN public.leads l ON l.id = bk.lead_id
      LEFT JOIN public.jobs j ON j.id = bk.job_id
      LEFT JOIN public.customers cu ON cu.id = COALESCE(j.customer_id, l.customer_id)
      WHERE (p_exclude_job IS NULL OR bk.job_id IS DISTINCT FROM p_exclude_job)
        AND (p_exclude_lead IS NULL OR bk.lead_id IS DISTINCT FROM p_exclude_lead)
    ) q;

    SELECT COALESCE(sum(GREATEST(0, (x->>'e')::int - (x->>'s')::int)), 0)::int INTO v_booked
      FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean;

    profile_id := p.id; full_name := p.full_name; booked_minutes := v_booked;
    work_start := w.start_time; work_end := w.end_time; best_start := NULL; next_free := NULL;
    blocks := (SELECT COALESCE(jsonb_agg(jsonb_build_object('start', to_char(public._mins_time((x->>'s')::int), 'HH24:MI'),
                'end', to_char(public._mins_time((x->>'e')::int), 'HH24:MI'), 'label', x->>'label')), '[]'::jsonb)
              FROM jsonb_array_elements(b) x);

    IF NOT w.is_working THEN
      tier := 3; status := CASE WHEN w.source = 'leave' THEN 'leave' ELSE 'off' END; km := NULL;
      reason := CASE WHEN w.source = 'leave' THEN 'On leave' ELSE 'Off today' END; sort_key := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    v_fit := v_req IS NOT NULL AND public._slot_fits(b, ws, we, v_req, v_m);

    -- nearest same-day job within 15 km
    SELECT (x->>'s')::int AS s, (x->>'e')::int AS e, (x->>'km')::numeric AS k, x->>'area' AS area INTO nb
      FROM jsonb_array_elements(b) x
      WHERE (x->>'pad')::boolean AND x->>'km' IS NOT NULL AND (x->>'km')::numeric <= 15
      ORDER BY (x->>'km')::numeric LIMIT 1;

    v_cand := NULL;
    IF nb.s IS NOT NULL AND (v_req IS NULL OR v_fit) THEN
      IF v_fit THEN v_cand := v_req;
      ELSIF public._slot_fits(b, ws, we, nb.e + 30, v_m) THEN v_cand := nb.e + 30;
      ELSIF public._slot_fits(b, ws, we, nb.s - 30 - v_m, v_m) THEN v_cand := nb.s - 30 - v_m;
      END IF;
    END IF;

    IF v_cand IS NOT NULL THEN
      tier := 1; status := 'free'; km := nb.k; sort_key := nb.k;
      best_start := public._mins_time(v_cand);
      next_free := CASE WHEN v_cand = v_req THEN NULL ELSE public._mins_time(v_cand) END;
      reason := 'Already in ' || COALESCE(nb.area, 'the area') || ' ' || to_char(public._mins_time(nb.s), 'HH24:MI') || '–'
        || to_char(public._mins_time(nb.e), 'HH24:MI') || ' · ' || nb.k || ' km'
        || CASE WHEN v_cand = v_req THEN '' ELSE ' · free from ' || to_char(public._mins_time(v_cand), 'HH24:MI') END;
      RETURN NEXT; CONTINUE;
    END IF;

    v_cand := CASE WHEN v_req IS NULL THEN public._first_fit(b, ws, we, ws, v_m) WHEN v_fit THEN v_req ELSE NULL END;
    IF v_cand IS NOT NULL THEN
      SELECT (x->>'e')::int AS e, (x->>'km')::numeric AS k INTO prev FROM jsonb_array_elements(b) x
        WHERE (x->>'pad')::boolean AND (x->>'e')::int <= v_cand AND x->>'lat' IS NOT NULL
        ORDER BY (x->>'e')::int DESC LIMIT 1;
      v_last := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'s')::int >= v_cand + v_m);
      v_back := CASE WHEN v_base_lat IS NULL OR p_lat IS NULL THEN NULL
                     ELSE round(public.calculate_distance_km(p_lat::numeric, p_lng::numeric, v_base_lat::numeric, v_base_lng::numeric), 1) END;
      tier := 2; status := 'free'; best_start := public._mins_time(v_cand);
      IF prev.e IS NOT NULL THEN
        km := prev.k;
        reason := 'Free · ' || COALESCE(prev.k || ' km', 'no location') || ' from ' || to_char(public._mins_time(prev.e), 'HH24:MI') || ' job';
      ELSIF v_booked = 0 THEN
        km := v_back;
        reason := 'Empty day' || COALESCE(' · starts from ' || v_base_label, '') || COALESCE(' · ' || v_back || ' km', '');
      ELSE
        km := v_back;
        reason := 'Free' || COALESCE(' · ' || v_back || ' km from ' || v_base_label, '');
      END IF;
      IF v_req IS NULL THEN reason := reason || ' · free from ' || to_char(best_start, 'HH24:MI'); END IF;
      sort_key := km + CASE WHEN v_last AND v_back IS NOT NULL THEN v_back * 0.25 ELSE 0 END;
      RETURN NEXT; CONTINUE;
    END IF;

    -- busy
    tier := 3; status := 'busy'; km := NULL; sort_key := NULL;
    v_next := public._first_fit(b, ws, we, COALESCE(v_req, ws), v_m);
    next_free := CASE WHEN v_next IS NULL THEN NULL ELSE public._mins_time(v_next) END;
    SELECT CASE WHEN (x->>'pad')::boolean THEN 'Booked ' WHEN x->>'label' ILIKE '%leave%' OR x->>'label' ILIKE 'off%' THEN 'Off ' ELSE 'Blocked ' END
      || to_char(public._mins_time((x->>'s')::int), 'HH24:MI') || '–' || to_char(public._mins_time((x->>'e')::int), 'HH24:MI')
      INTO v_clash FROM jsonb_array_elements(b) x
      WHERE v_req IS NOT NULL AND (x->>'s')::int < v_req + v_m + 30 AND (x->>'e')::int + 30 > v_req
      ORDER BY (x->>'s')::int LIMIT 1;
    reason := CASE WHEN v_clash IS NOT NULL THEN v_clash
                   WHEN v_req IS NOT NULL AND (v_req < ws OR v_req + v_m > we) THEN 'Outside hours ' || to_char(w.start_time,'HH24:MI') || '–' || to_char(w.end_time,'HH24:MI')
                   ELSE 'Fully booked' END
      || CASE WHEN v_next IS NOT NULL THEN ' · next free ' || to_char(public._mins_time(v_next), 'HH24:MI') ELSE '' END;
    RETURN NEXT;
  END LOOP;
END $$;

-- ROLLBACK (previous bodies from 0004):
-- CREATE OR REPLACE FUNCTION public._slot_fits(p_b jsonb, p_ws int, p_we int, p_s int, p_m int)
-- RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
--   SELECT p_s >= p_ws AND p_s + p_m <= p_we
--     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_b,'[]'::jsonb)) x
--       WHERE p_s < (x->>'e')::int + CASE WHEN (x->>'pad')::boolean THEN 30 ELSE 0 END
--         AND p_s + p_m + CASE WHEN (x->>'pad')::boolean THEN 30 ELSE 0 END > (x->>'s')::int)
--     AND (p_s + p_m + 30 <= p_we OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_b,'[]'::jsonb)) x
--       WHERE (x->>'pad')::boolean AND (x->>'s')::int >= p_s + p_m));
-- $$;
-- 
-- CREATE OR REPLACE FUNCTION public._first_fit(p_b jsonb, p_ws int, p_we int, p_after int, p_m int)
-- RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
--   SELECT min(c) FROM (
--     SELECT ((GREATEST(p_ws, p_after) + 4) / 5) * 5 AS c
--     UNION
--     SELECT (((x->>'e')::int + CASE WHEN (x->>'pad')::boolean THEN 30 ELSE 0 END + 4) / 5) * 5
--     FROM jsonb_array_elements(COALESCE(p_b,'[]'::jsonb)) x
--   ) q WHERE c >= p_after AND public._slot_fits(p_b, p_ws, p_we, c, p_m);
-- $$;
-- 
-- -- Core ranking. p_start NULL = suggestion mode (best_start = best fitting start).
-- CREATE OR REPLACE FUNCTION public._rank_core(p_lane text, p_date date, p_start time, p_minutes int,
--   p_lat double precision, p_lng double precision, p_exclude_job uuid, p_exclude_lead uuid)
-- RETURNS TABLE(profile_id uuid, full_name text, tier int, status text, km numeric, reason text, next_free time,
--   booked_minutes int, work_start time, work_end time, blocks jsonb, best_start time, sort_key numeric)
-- LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
-- DECLARE
--   v_uid uuid := auth.uid(); v_company uuid := public.caller_company_id(); v_full boolean;
--   v_m int := GREATEST(COALESCE(p_minutes, 60), 5);
--   v_req int := CASE WHEN p_start IS NULL THEN NULL ELSE (extract(epoch FROM p_start) / 60)::int END;
--   p record; w record; b jsonb; ws int; we int; v_booked int;
--   nb record; prev record; v_base_lat double precision; v_base_lng double precision; v_base_label text;
--   v_fit boolean; v_cand int; v_next int; v_km numeric; v_back numeric; v_sort numeric; v_last boolean;
--   v_clash text;
-- BEGIN
--   v_full := v_uid IS NULL OR public.has_role(v_uid, 'admin')
--     OR (public.is_ops_user(v_uid) AND COALESCE((SELECT dispatch_role FROM public.profiles WHERE id = v_uid), '') <> 'sales');
-- 
--   FOR p IN
--     SELECT pr.id, pr.full_name, pr.start_from, pr.home_lat, pr.home_lng, pr.office_lat, pr.office_lng,
--            hb.lat AS hb_lat, hb.lng AS hb_lng, hb.address AS hb_addr, c.office_lat AS c_lat, c.office_lng AS c_lng
--     FROM public.profiles pr
--     LEFT JOIN public.staff_home_bases hb ON hb.profile_id = pr.id
--     LEFT JOIN public.companies c ON c.id = pr.company_id
--     WHERE pr.company_id = v_company AND COALESCE(pr.dispatch_active, false) AND pr.archived_at IS NULL
--       AND (v_full OR pr.id = v_uid)
--       AND CASE WHEN p_lane = 'sales'
--             THEN pr.dispatch_role = 'sales' AND COALESCE(pr.participant_type,'') <> 'independent_tech'
--             ELSE pr.dispatch_role = 'technician' OR pr.participant_type = 'independent_tech' END
--   LOOP
--     SELECT * INTO w FROM public.staff_work_window(p.id, p_date);
--     ws := (extract(epoch FROM w.start_time) / 60)::int; we := (extract(epoch FROM w.end_time) / 60)::int;
-- 
--     -- start base (never expose the home street address)
--     v_base_lat := NULL; v_base_lng := NULL; v_base_label := NULL;
--     IF COALESCE(p.start_from, 'home') = 'home' AND p.hb_lat IS NOT NULL THEN
--       v_base_lat := p.hb_lat; v_base_lng := p.hb_lng;
--       v_base_label := 'Home' || COALESCE(' (' || NULLIF(trim(split_part(p.hb_addr, ',', 2)), '') || ')', '');
--     ELSIF COALESCE(p.start_from, '') <> 'office' AND p.home_lat IS NOT NULL THEN
--       v_base_lat := p.home_lat; v_base_lng := p.home_lng; v_base_label := 'Home';
--     ELSIF p.office_lat IS NOT NULL THEN
--       v_base_lat := p.office_lat; v_base_lng := p.office_lng; v_base_label := 'Office';
--     ELSIF p.c_lat IS NOT NULL THEN
--       v_base_lat := p.c_lat; v_base_lng := p.c_lng; v_base_label := 'Office';
--     END IF;
-- 
--     SELECT COALESCE(jsonb_agg(jsonb_build_object(
--              's', (extract(epoch FROM q.start_time) / 60)::int,
--              'e', (extract(epoch FROM q.end_time) / 60)::int,
--              'pad', (q.job_id IS NOT NULL OR q.lead_id IS NOT NULL),
--              'lat', q.lat, 'lng', q.lng, 'area', q.area,
--              'label', CASE WHEN q.job_id IS NULL AND q.lead_id IS NULL THEN q.customer_name
--                            WHEN v_full OR p.id = v_uid THEN COALESCE(q.customer_name, 'Booking') ELSE 'Busy' END,
--              'km', CASE WHEN q.lat IS NULL OR p_lat IS NULL THEN NULL
--                         ELSE round(public.calculate_distance_km(p_lat::numeric, p_lng::numeric, q.lat, q.lng), 1) END
--            ) ORDER BY q.start_time), '[]'::jsonb)
--       INTO b
--     FROM (
--       SELECT bk.*, COALESCE(l.latitude, j.lat, cu.latitude) AS lat, COALESCE(l.longitude, j.lng, cu.longitude) AS lng,
--              COALESCE(NULLIF(trim(split_part(l.customer_address, ',', 2)), ''), cu.city) AS area
--       FROM public._person_bookings(p.id, p_date) bk
--       LEFT JOIN public.leads l ON l.id = bk.lead_id
--       LEFT JOIN public.jobs j ON j.id = bk.job_id
--       LEFT JOIN public.customers cu ON cu.id = COALESCE(j.customer_id, l.customer_id)
--       WHERE (p_exclude_job IS NULL OR bk.job_id IS DISTINCT FROM p_exclude_job)
--         AND (p_exclude_lead IS NULL OR bk.lead_id IS DISTINCT FROM p_exclude_lead)
--     ) q;
-- 
--     SELECT COALESCE(sum(GREATEST(0, (x->>'e')::int - (x->>'s')::int)), 0)::int INTO v_booked
--       FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean;
-- 
--     profile_id := p.id; full_name := p.full_name; booked_minutes := v_booked;
--     work_start := w.start_time; work_end := w.end_time; best_start := NULL; next_free := NULL;
--     blocks := (SELECT COALESCE(jsonb_agg(jsonb_build_object('start', to_char(public._mins_time((x->>'s')::int), 'HH24:MI'),
--                 'end', to_char(public._mins_time((x->>'e')::int), 'HH24:MI'), 'label', x->>'label')), '[]'::jsonb)
--               FROM jsonb_array_elements(b) x);
-- 
--     IF NOT w.is_working THEN
--       tier := 3; status := CASE WHEN w.source = 'leave' THEN 'leave' ELSE 'off' END; km := NULL;
--       reason := CASE WHEN w.source = 'leave' THEN 'On leave' ELSE 'Off today' END; sort_key := NULL;
--       RETURN NEXT; CONTINUE;
--     END IF;
-- 
--     v_fit := v_req IS NOT NULL AND public._slot_fits(b, ws, we, v_req, v_m);
-- 
--     -- nearest same-day job within 15 km
--     SELECT (x->>'s')::int AS s, (x->>'e')::int AS e, (x->>'km')::numeric AS k, x->>'area' AS area INTO nb
--       FROM jsonb_array_elements(b) x
--       WHERE (x->>'pad')::boolean AND x->>'km' IS NOT NULL AND (x->>'km')::numeric <= 15
--       ORDER BY (x->>'km')::numeric LIMIT 1;
-- 
--     v_cand := NULL;
--     IF nb.s IS NOT NULL THEN
--       IF v_fit THEN v_cand := v_req;
--       ELSIF public._slot_fits(b, ws, we, nb.e + 30, v_m) THEN v_cand := nb.e + 30;
--       ELSIF public._slot_fits(b, ws, we, nb.s - 30 - v_m, v_m) THEN v_cand := nb.s - 30 - v_m;
--       END IF;
--     END IF;
-- 
--     IF v_cand IS NOT NULL THEN
--       tier := 1; status := 'free'; km := nb.k; sort_key := nb.k;
--       best_start := public._mins_time(v_cand);
--       next_free := CASE WHEN v_cand = v_req THEN NULL ELSE public._mins_time(v_cand) END;
--       reason := 'Already in ' || COALESCE(nb.area, 'the area') || ' ' || to_char(public._mins_time(nb.s), 'HH24:MI') || '–'
--         || to_char(public._mins_time(nb.e), 'HH24:MI') || ' · ' || nb.k || ' km'
--         || CASE WHEN v_cand = v_req THEN '' ELSE ' · free from ' || to_char(public._mins_time(v_cand), 'HH24:MI') END;
--       RETURN NEXT; CONTINUE;
--     END IF;
-- 
--     v_cand := CASE WHEN v_req IS NULL THEN public._first_fit(b, ws, we, ws, v_m) WHEN v_fit THEN v_req ELSE NULL END;
--     IF v_cand IS NOT NULL THEN
--       SELECT (x->>'e')::int AS e, (x->>'km')::numeric AS k INTO prev FROM jsonb_array_elements(b) x
--         WHERE (x->>'pad')::boolean AND (x->>'e')::int <= v_cand AND x->>'lat' IS NOT NULL
--         ORDER BY (x->>'e')::int DESC LIMIT 1;
--       v_last := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'s')::int >= v_cand + v_m);
--       v_back := CASE WHEN v_base_lat IS NULL OR p_lat IS NULL THEN NULL
--                      ELSE round(public.calculate_distance_km(p_lat::numeric, p_lng::numeric, v_base_lat::numeric, v_base_lng::numeric), 1) END;
--       tier := 2; status := 'free'; best_start := public._mins_time(v_cand);
--       IF prev.e IS NOT NULL THEN
--         km := prev.k;
--         reason := 'Free · ' || COALESCE(prev.k || ' km', 'km ?') || ' from ' || to_char(public._mins_time(prev.e), 'HH24:MI') || ' job';
--       ELSIF v_booked = 0 THEN
--         km := v_back;
--         reason := 'Empty day' || COALESCE(' · starts from ' || v_base_label, '') || COALESCE(' · ' || v_back || ' km', '');
--       ELSE
--         km := v_back;
--         reason := 'Free' || COALESCE(' · ' || v_back || ' km from ' || v_base_label, '');
--       END IF;
--       IF v_req IS NULL THEN reason := reason || ' · free from ' || to_char(best_start, 'HH24:MI'); END IF;
--       sort_key := km + CASE WHEN v_last AND v_back IS NOT NULL THEN v_back * 0.25 ELSE 0 END;
--       RETURN NEXT; CONTINUE;
--     END IF;
-- 
--     -- busy
--     tier := 3; status := 'busy'; km := NULL; sort_key := NULL;
--     v_next := public._first_fit(b, ws, we, COALESCE(v_req, ws), v_m);
--     next_free := CASE WHEN v_next IS NULL THEN NULL ELSE public._mins_time(v_next) END;
--     SELECT to_char(public._mins_time((x->>'s')::int), 'HH24:MI') || '–' || to_char(public._mins_time((x->>'e')::int), 'HH24:MI')
--       INTO v_clash FROM jsonb_array_elements(b) x
--       WHERE v_req IS NOT NULL AND (x->>'s')::int < v_req + v_m + 30 AND (x->>'e')::int + 30 > v_req
--       ORDER BY (x->>'s')::int LIMIT 1;
--     reason := CASE WHEN v_clash IS NOT NULL THEN 'Busy ' || v_clash
--                    WHEN v_req IS NOT NULL AND (v_req < ws OR v_req + v_m > we) THEN 'Outside hours ' || to_char(w.start_time,'HH24:MI') || '–' || to_char(w.end_time,'HH24:MI')
--                    ELSE 'Fully booked' END
--       || CASE WHEN v_next IS NOT NULL THEN ' · next free ' || to_char(public._mins_time(v_next), 'HH24:MI') ELSE '' END;
--     RETURN NEXT;
--   END LOOP;
-- END $$;
