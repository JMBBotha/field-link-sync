-- Rollback tech offers fit (2026-10-09): drop the claim guard + tech offer functions, restore the original _rep_lead_fit body.
DROP TRIGGER IF EXISTS trg_tech_claim_guard ON public.leads;
DROP FUNCTION IF EXISTS public._tech_claim_guard();
DROP FUNCTION IF EXISTS public.tech_offers(uuid);
DROP FUNCTION IF EXISTS public._tech_offer_fit(uuid, uuid);
DROP FUNCTION IF EXISTS public._tech_offer_minutes(uuid);
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
DROP FUNCTION IF EXISTS public._staff_slot_fit(uuid, uuid, date, time, int, numeric, numeric, time);
DROP FUNCTION IF EXISTS public._slot_travel_eval(jsonb, int, int, int, int, numeric, numeric, numeric, numeric, text);
