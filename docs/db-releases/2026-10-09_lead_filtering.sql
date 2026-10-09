-- Lead filtering (2026-10-09). No constraints added: Mandy/website leads without a time are never rejected.
-- Reps are offered an unassigned sales lead only if: it has a date+time+location, they work then and are free
-- (bookings + blocked time + 30-min buffer, S5 _slot_fits), it's within 15 km of their previous same-day job
-- (or their base if none before it), travel fits (40 km/h), they reach the next job / get back to base before finish.
CREATE OR REPLACE FUNCTION public._rep_lead_fit(p_profile uuid, p_lead uuid)
 RETURNS TABLE(fits boolean, km numeric, label text, reason text, best_start time without time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE
  l record; p record; w record; b jsonb; ws int; we int; v_req int; v_m int;
  v_blat double precision; v_blng double precision; v_bl text;
  prev record; nxt record; v_olat numeric; v_olng numeric; v_km numeric; v_back numeric; v_nkm numeric;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL THEN RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Lead not found', NULL::time; RETURN; END IF;
  IF l.scheduled_date IS NULL OR l.scheduled_time IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Needs appointment time', NULL::time; RETURN; END IF;
  IF l.latitude IS NULL OR l.longitude IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'No location on lead', NULL::time; RETURN; END IF;

  SELECT pr.id, pr.start_from, pr.home_lat, pr.home_lng, pr.office_lat, pr.office_lng,
         hb.lat AS hb_lat, hb.lng AS hb_lng, c.office_lat AS c_lat, c.office_lng AS c_lng
    INTO p FROM public.profiles pr
    LEFT JOIN public.staff_home_bases hb ON hb.profile_id = pr.id
    LEFT JOIN public.companies c ON c.id = pr.company_id
   WHERE pr.id = p_profile;
  -- same base order as S5 _rank_core
  IF COALESCE(p.start_from, 'home') = 'home' AND p.hb_lat IS NOT NULL THEN v_blat := p.hb_lat; v_blng := p.hb_lng; v_bl := 'home';
  ELSIF COALESCE(p.start_from, '') <> 'office' AND p.home_lat IS NOT NULL THEN v_blat := p.home_lat; v_blng := p.home_lng; v_bl := 'home';
  ELSIF p.office_lat IS NOT NULL THEN v_blat := p.office_lat; v_blng := p.office_lng; v_bl := 'office';
  ELSIF p.c_lat IS NOT NULL THEN v_blat := p.c_lat; v_blng := p.c_lng; v_bl := 'office';
  END IF;
  IF v_blat IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'No home or office base set', NULL::time; RETURN; END IF;

  SELECT * INTO w FROM public.staff_work_window(p_profile, l.scheduled_date);
  IF NOT w.is_working THEN RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Not working that day', NULL::time; RETURN; END IF;
  ws := (extract(epoch FROM w.start_time) / 60)::int; we := (extract(epoch FROM w.end_time) / 60)::int;
  v_req := (extract(epoch FROM l.scheduled_time) / 60)::int;
  v_m := GREATEST(COALESCE(l.estimated_duration_minutes, 60), 5);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           's', (extract(epoch FROM q.start_time) / 60)::int, 'e', (extract(epoch FROM q.end_time) / 60)::int,
           'pad', (q.job_id IS NOT NULL OR q.lead_id IS NOT NULL), 'lat', q.lat, 'lng', q.lng) ORDER BY q.start_time), '[]'::jsonb)
    INTO b
    FROM (SELECT bk.*, COALESCE(l2.latitude, j.lat, cu.latitude) AS lat, COALESCE(l2.longitude, j.lng, cu.longitude) AS lng
            FROM public._person_bookings(p_profile, l.scheduled_date) bk
            LEFT JOIN public.leads l2 ON l2.id = bk.lead_id
            LEFT JOIN public.jobs j ON j.id = bk.job_id
            LEFT JOIN public.customers cu ON cu.id = COALESCE(j.customer_id, l2.customer_id)
           WHERE bk.lead_id IS DISTINCT FROM p_lead) q;

  IF NOT public._slot_fits(b, ws, we, v_req, v_m) THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text,
      CASE WHEN v_req < ws OR v_req + v_m > we THEN 'Outside working hours' ELSE 'Busy at that time' END, NULL::time; RETURN; END IF;

  SELECT (x->>'s')::int AS s, (x->>'e')::int AS e, (x->>'lat')::numeric AS lat, (x->>'lng')::numeric AS lng INTO prev
    FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'e')::int <= v_req
    ORDER BY (x->>'e')::int DESC LIMIT 1;
  SELECT (x->>'s')::int AS s, (x->>'lat')::numeric AS lat, (x->>'lng')::numeric AS lng INTO nxt
    FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'s')::int >= v_req + v_m
    ORDER BY (x->>'s')::int LIMIT 1;

  IF prev.e IS NOT NULL AND prev.lat IS NOT NULL THEN v_olat := prev.lat; v_olng := prev.lng;
  ELSE v_olat := v_blat; v_olng := v_blng; END IF;
  v_km := round(public.calculate_distance_km(v_olat, v_olng, l.latitude, l.longitude), 1);
  IF v_km > 15 THEN
    RETURN QUERY SELECT false, v_km, NULL::text,
      'More than 15 km from ' || CASE WHEN prev.e IS NOT NULL AND prev.lat IS NOT NULL THEN 'previous job' ELSE v_bl END, NULL::time; RETURN; END IF;
  -- travel in (40 km/h)
  IF COALESCE(prev.e, ws) + ceil(v_km / 40.0 * 60)::int > v_req THEN
    RETURN QUERY SELECT false, v_km, NULL::text, 'Not enough travel time', NULL::time; RETURN; END IF;
  -- onward: next job, else back to base before finish
  IF nxt.s IS NOT NULL THEN
    IF nxt.lat IS NOT NULL THEN
      v_nkm := public.calculate_distance_km(l.latitude, l.longitude, nxt.lat, nxt.lng);
      IF v_req + v_m + ceil(v_nkm / 40.0 * 60)::int > nxt.s THEN
        RETURN QUERY SELECT false, v_km, NULL::text, 'No time to reach the next job', NULL::time; RETURN; END IF;
    END IF;
  ELSE
    v_back := public.calculate_distance_km(l.latitude, l.longitude, v_blat::numeric, v_blng::numeric);
    IF v_req + v_m + ceil(v_back / 40.0 * 60)::int > we THEN
      RETURN QUERY SELECT false, v_km, NULL::text, 'Can''t get back to base before finish', NULL::time; RETURN; END IF;
  END IF;

  RETURN QUERY SELECT true, v_km,
    CASE WHEN prev.e IS NOT NULL AND prev.lat IS NOT NULL THEN 'near your ' || to_char(public._mins_time(prev.s), 'HH24:MI') || ' job'
         ELSE 'near ' || v_bl END,
    'Fits', l.scheduled_time;
END $f$;
REVOKE ALL ON FUNCTION public._rep_lead_fit(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Caller's (sales rep) offerable unassigned leads, nearest first.
CREATE OR REPLACE FUNCTION public.rep_offerable_leads()
 RETURNS TABLE(lead_id uuid, km numeric, label text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT l.id, f.km, f.label
    FROM public.leads l CROSS JOIN LATERAL public._rep_lead_fit(auth.uid(), l.id) f
   WHERE auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())
     AND l.company_id = public.get_user_company_id(auth.uid())
     AND l.assigned_agent_id IS NULL AND l.status = 'pending'
     AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND COALESCE(l.primary_intent::text, 'sales') = 'sales'
     AND f.fits
   ORDER BY f.km NULLS LAST;
$f$;
REVOKE ALL ON FUNCTION public.rep_offerable_leads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_offerable_leads() TO authenticated;

-- Admin/office (not reps, not techs): reps with no base, and pending unassigned sales leads no rep is offered, with why.
CREATE OR REPLACE FUNCTION public.get_lead_offer_flags()
 RETURNS TABLE(lead_id uuid, customer_name text, scheduled_date date, scheduled_time time without time zone, issue text, detail text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_co uuid; l record; r record; v_any boolean; v_why text[];
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin') OR (public.is_ops_user(v_uid) AND NOT public.is_sales_rep(v_uid)))
     OR public.is_field_tech_only(v_uid) THEN RETURN; END IF;
  v_co := public.get_user_company_id(v_uid);
  /*lf2*/ FOR r IN SELECT pr.id, pr.full_name FROM public.profiles pr LEFT JOIN public.staff_home_bases hb ON hb.profile_id = pr.id
     LEFT JOIN public.companies c ON c.id = pr.company_id
    WHERE pr.company_id = v_co AND pr.dispatch_role = 'sales' AND COALESCE(pr.dispatch_active, false) AND pr.archived_at IS NULL
      AND public.is_sales_rep(pr.id)
      AND hb.lat IS NULL AND pr.home_lat IS NULL AND pr.office_lat IS NULL AND c.office_lat IS NULL LOOP
    lead_id := NULL; customer_name := trim(r.full_name); scheduled_date := NULL; scheduled_time := NULL;
    issue := 'rep_no_base'; detail := trim(r.full_name) || ' has no home or office base, so they are not offered any leads. Set it on the Team page.';
    RETURN NEXT;
  END LOOP;
  FOR l IN SELECT * FROM public.leads x WHERE x.company_id = v_co AND x.assigned_agent_id IS NULL AND x.status = 'pending'
             AND x.deleted_at IS NULL AND x.merged_into_id IS NULL AND COALESCE(x.primary_intent::text, 'sales') = 'sales'
             ORDER BY x.created_at DESC LOOP
    lead_id := l.id; customer_name := l.customer_name; scheduled_date := l.scheduled_date; scheduled_time := l.scheduled_time;
    IF l.scheduled_date IS NULL OR l.scheduled_time IS NULL THEN
      issue := 'needs_time'; detail := 'Needs appointment time'; RETURN NEXT; CONTINUE; END IF;
    IF l.latitude IS NULL THEN issue := 'no_location'; detail := 'No location on lead'; RETURN NEXT; CONTINUE; END IF;
    v_any := false; v_why := ARRAY[]::text[];
    FOR r IN SELECT pr.id, pr.full_name FROM public.profiles pr
              WHERE pr.company_id = v_co AND pr.dispatch_role = 'sales' AND COALESCE(pr.dispatch_active, false) AND pr.archived_at IS NULL AND public.is_sales_rep(pr.id) /*lf3*/ LOOP
      DECLARE f record; BEGIN
        SELECT * INTO f FROM public._rep_lead_fit(r.id, l.id);
        IF f.fits THEN v_any := true; ELSE v_why := v_why || (trim(r.full_name) || ': ' || f.reason); END IF;
      END;
    END LOOP;
    IF NOT v_any THEN
      issue := 'no_rep_fits';
      detail := 'Not offered to anyone · ' || array_to_string(v_why, '; ');
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$;
REVOKE ALL ON FUNCTION public.get_lead_offer_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lead_offer_flags() TO authenticated;

-- get_my_appointments: reps only see unassigned leads that fit them.
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_my_appointments(integer)'::regprocedure);
  IF position('/*lf*/' in d) = 0 THEN
    d := replace(d, 'OR COALESCE(l.primary_intent::text, ''sales'') = ''sales'')))',
      'OR (COALESCE(l.primary_intent::text, ''sales'') = ''sales'' /*lf*/ AND EXISTS (SELECT 1 FROM public.rep_offerable_leads() o WHERE o.lead_id = l.id)))))');
    IF position('/*lf*/' in d) = 0 THEN RAISE EXCEPTION 'appointments anchor not found'; END IF;
    EXECUTE d;
  END IF;
END $$;
