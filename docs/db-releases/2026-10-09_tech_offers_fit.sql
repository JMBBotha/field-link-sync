-- Tech offers fit (2026-10-09). Shares the sales lead-filtering rules (cc80319e): S5 _slot_fits (30-min buffer),
-- 15 km from previous same-day job or base, 40 km/h travel in, reach next job / back to base before finish.
-- The per-slot checks move out of _rep_lead_fit into shared helpers; _rep_lead_fit keeps its exact results.
-- First-accept / agent_availability untouched. No messages.

DROP FUNCTION IF EXISTS public._staff_slot_fit(uuid,uuid,date,time,int,double precision,double precision,time);
DROP FUNCTION IF EXISTS public._slot_travel_eval(jsonb,int,int,int,int,double precision,double precision,double precision,double precision,text);
-- 1) Pure check of one start time against a day's bookings (b = S5 booking json, minutes from midnight).
CREATE OR REPLACE FUNCTION public._slot_travel_eval(b jsonb, ws int, we int, v_req int, v_m int,
  p_lat numeric, p_lng numeric, v_blat numeric, v_blng numeric, v_bl text)
 RETURNS TABLE(fits boolean, km numeric, label text, reason text)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $f$
DECLARE prev record; nxt record; v_olat numeric; v_olng numeric; v_km numeric; v_back numeric; v_nkm numeric;
BEGIN
  IF NOT public._slot_fits(b, ws, we, v_req, v_m) THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text,
      CASE WHEN v_req < ws OR v_req + v_m > we THEN 'Outside working hours' ELSE 'Busy at that time' END; RETURN; END IF;
  SELECT (x->>'s')::int AS s, (x->>'e')::int AS e, (x->>'lat')::numeric AS lat, (x->>'lng')::numeric AS lng INTO prev
    FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'e')::int <= v_req
    ORDER BY (x->>'e')::int DESC LIMIT 1;
  SELECT (x->>'s')::int AS s, (x->>'lat')::numeric AS lat, (x->>'lng')::numeric AS lng INTO nxt
    FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'s')::int >= v_req + v_m
    ORDER BY (x->>'s')::int LIMIT 1;
  IF prev.e IS NOT NULL AND prev.lat IS NOT NULL THEN v_olat := prev.lat; v_olng := prev.lng;
  ELSE v_olat := v_blat; v_olng := v_blng; END IF;
  v_km := round(public.calculate_distance_km(v_olat, v_olng, p_lat, p_lng), 1);
  IF v_km > 15 THEN
    RETURN QUERY SELECT false, v_km, NULL::text,
      'More than 15 km from ' || CASE WHEN prev.e IS NOT NULL AND prev.lat IS NOT NULL THEN 'previous job' ELSE v_bl END; RETURN; END IF;
  IF COALESCE(prev.e, ws) + ceil(v_km / 40.0 * 60)::int > v_req THEN
    RETURN QUERY SELECT false, v_km, NULL::text, 'Not enough travel time'; RETURN; END IF;
  IF nxt.s IS NOT NULL THEN
    IF nxt.lat IS NOT NULL THEN
      v_nkm := public.calculate_distance_km(p_lat, p_lng, nxt.lat, nxt.lng);
      IF v_req + v_m + ceil(v_nkm / 40.0 * 60)::int > nxt.s THEN
        RETURN QUERY SELECT false, v_km, NULL::text, 'No time to reach the next job'; RETURN; END IF;
    END IF;
  ELSE
    v_back := public.calculate_distance_km(p_lat, p_lng, v_blat::numeric, v_blng::numeric);
    IF v_req + v_m + ceil(v_back / 40.0 * 60)::int > we THEN
      RETURN QUERY SELECT false, v_km, NULL::text, 'Can''t get back to base before finish'; RETURN; END IF;
  END IF;
  RETURN QUERY SELECT true, v_km,
    CASE WHEN prev.e IS NOT NULL AND prev.lat IS NOT NULL THEN 'near your ' || to_char(public._mins_time(prev.s), 'HH24:MI') || ' job'
         ELSE 'near ' || v_bl END,
    'Fits';
END $f$;
REVOKE ALL ON FUNCTION public._slot_travel_eval(jsonb,int,int,int,int,numeric,numeric,numeric,numeric,text) FROM PUBLIC, anon, authenticated;

-- 2) One person, one day: base + work window + bookings, then check p_start, or (p_start NULL) the first start
--    at/after p_after that fits incl. travel (candidates: day start, after each booking + 30 min or + travel).
CREATE OR REPLACE FUNCTION public._staff_slot_fit(p_profile uuid, p_exclude_lead uuid, p_date date, p_start time,
  p_minutes int, p_lat numeric, p_lng numeric, p_after time DEFAULT NULL)
 RETURNS TABLE(fits boolean, km numeric, label text, reason text, best_start time without time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE
  p record; w record; b jsonb; ws int; we int; v_m int; v_from int; c int; r record; v_last text;
  v_blat numeric; v_blng numeric; v_bl text;
BEGIN
  SELECT pr.id, pr.start_from, pr.home_lat, pr.home_lng, pr.office_lat, pr.office_lng,
         hb.lat AS hb_lat, hb.lng AS hb_lng, c2.office_lat AS c_lat, c2.office_lng AS c_lng
    INTO p FROM public.profiles pr
    LEFT JOIN public.staff_home_bases hb ON hb.profile_id = pr.id
    LEFT JOIN public.companies c2 ON c2.id = pr.company_id
   WHERE pr.id = p_profile;
  -- same base order as S5 _rank_core
  IF COALESCE(p.start_from, 'home') = 'home' AND p.hb_lat IS NOT NULL THEN v_blat := p.hb_lat; v_blng := p.hb_lng; v_bl := 'home';
  ELSIF COALESCE(p.start_from, '') <> 'office' AND p.home_lat IS NOT NULL THEN v_blat := p.home_lat; v_blng := p.home_lng; v_bl := 'home';
  ELSIF p.office_lat IS NOT NULL THEN v_blat := p.office_lat; v_blng := p.office_lng; v_bl := 'office';
  ELSIF p.c_lat IS NOT NULL THEN v_blat := p.c_lat; v_blng := p.c_lng; v_bl := 'office';
  END IF;
  IF v_blat IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'No home or office base set', NULL::time; RETURN; END IF;

  SELECT * INTO w FROM public.staff_work_window(p_profile, p_date);
  IF NOT w.is_working THEN RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Not working that day', NULL::time; RETURN; END IF;
  ws := (extract(epoch FROM w.start_time) / 60)::int; we := (extract(epoch FROM w.end_time) / 60)::int;
  v_m := GREATEST(COALESCE(p_minutes, 60), 5);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           's', (extract(epoch FROM q.start_time) / 60)::int, 'e', (extract(epoch FROM q.end_time) / 60)::int,
           'pad', (q.job_id IS NOT NULL OR q.lead_id IS NOT NULL), 'lat', q.lat, 'lng', q.lng) ORDER BY q.start_time), '[]'::jsonb)
    INTO b
    FROM (SELECT bk.*, COALESCE(l2.latitude, j.lat, cu.latitude) AS lat, COALESCE(l2.longitude, j.lng, cu.longitude) AS lng
            FROM public._person_bookings(p_profile, p_date) bk
            LEFT JOIN public.leads l2 ON l2.id = bk.lead_id
            LEFT JOIN public.jobs j ON j.id = bk.job_id
            LEFT JOIN public.customers cu ON cu.id = COALESCE(j.customer_id, l2.customer_id)
           WHERE bk.lead_id IS DISTINCT FROM p_exclude_lead) q;

  IF p_start IS NOT NULL THEN
    SELECT * INTO r FROM public._slot_travel_eval(b, ws, we, (extract(epoch FROM p_start) / 60)::int, v_m, p_lat, p_lng, v_blat, v_blng, v_bl);
    RETURN QUERY SELECT r.fits, r.km, r.label, r.reason, CASE WHEN r.fits THEN p_start END; RETURN;
  END IF;

  v_from := GREATEST(ws, COALESCE((extract(epoch FROM p_after) / 60)::int, 0));
  v_last := 'No free time that day';
  FOR c IN
    SELECT DISTINCT ((x + 4) / 5) * 5 AS c FROM (
      SELECT v_from AS x
      UNION ALL SELECT ws + ceil(public.calculate_distance_km(v_blat::numeric, v_blng::numeric, p_lat, p_lng) / 40.0 * 60)::int
      UNION ALL SELECT (e->>'e')::int + 30 FROM jsonb_array_elements(b) e
      UNION ALL SELECT (e->>'e')::int + ceil(public.calculate_distance_km((e->>'lat')::numeric, (e->>'lng')::numeric, p_lat, p_lng) / 40.0 * 60)::int
        FROM jsonb_array_elements(b) e WHERE (e->>'pad')::boolean AND e->>'lat' IS NOT NULL
    ) q WHERE x >= v_from ORDER BY 1
  LOOP
    SELECT * INTO r FROM public._slot_travel_eval(b, ws, we, c, v_m, p_lat, p_lng, v_blat, v_blng, v_bl);
    IF r.fits THEN RETURN QUERY SELECT true, r.km, r.label, r.reason, public._mins_time(c); RETURN; END IF;
    IF r.reason NOT IN ('Busy at that time', 'Outside working hours') THEN v_last := r.reason; END IF;
  END LOOP;
  RETURN QUERY SELECT false, NULL::numeric, NULL::text, v_last, NULL::time;
END $f$;
REVOKE ALL ON FUNCTION public._staff_slot_fit(uuid,uuid,date,time,int,numeric,numeric,time) FROM PUBLIC, anon, authenticated;

-- 3) Sales reps: same results as before, now via the shared helper.
CREATE OR REPLACE FUNCTION public._rep_lead_fit(p_profile uuid, p_lead uuid)
 RETURNS TABLE(fits boolean, km numeric, label text, reason text, best_start time without time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE l record;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL THEN RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Lead not found', NULL::time; RETURN; END IF;
  IF l.scheduled_date IS NULL OR l.scheduled_time IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Needs appointment time', NULL::time; RETURN; END IF;
  IF l.latitude IS NULL OR l.longitude IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'No location on lead', NULL::time; RETURN; END IF;
  RETURN QUERY SELECT * FROM public._staff_slot_fit(p_profile, p_lead, l.scheduled_date, l.scheduled_time,
    COALESCE(l.estimated_duration_minutes, 60), l.latitude, l.longitude);
END $f$;
REVOKE ALL ON FUNCTION public._rep_lead_fit(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 4) Job length for an offer: booking/job duration > lead estimate > quote labour hours > default for the job type.
CREATE OR REPLACE FUNCTION public._tech_offer_minutes(p_lead uuid)
 RETURNS TABLE(minutes int, source text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE l record; v int; v_q numeric;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  SELECT (extract(epoch FROM j.estimated_duration) / 60)::int INTO v FROM public.jobs j
   WHERE j.lead_id = p_lead AND j.estimated_duration IS NOT NULL ORDER BY j.created_at DESC LIMIT 1;
  IF v > 0 THEN RETURN QUERY SELECT v, 'booking'; RETURN; END IF;
  IF l.estimated_duration_minutes > 0 THEN RETURN QUERY SELECT l.estimated_duration_minutes, 'booking'; RETURN; END IF;
  SELECT sum(qi.quantity) INTO v_q FROM public.quote_items qi
   WHERE lower(COALESCE(qi.item_type, '')) = 'labour' AND qi.quote_id = (
     SELECT q.id FROM public.quotes q WHERE q.lead_id = p_lead
        AND lower(COALESCE(q.status, '')) NOT IN ('declined', 'rejected', 'cancelled', 'canceled', 'expired', 'archived')
      ORDER BY (lower(q.status) = 'accepted') DESC, q.created_at DESC LIMIT 1);
  IF v_q > 0 THEN RETURN QUERY SELECT LEAST(GREATEST(round(v_q * 60)::int, 30), 12 * 60), 'quote'; RETURN; END IF;
  RETURN QUERY SELECT public.default_booking_minutes(COALESCE(l.service_type, l.primary_intent::text)), 'estimate';
END $f$;
REVOKE ALL ON FUNCTION public._tech_offer_minutes(uuid) FROM PUBLIC, anon, authenticated;

-- 5) Does an open lead fit this tech? Booked leads: their own date/time. Unbooked: first fit in the next 7 days.
CREATE OR REPLACE FUNCTION public._tech_offer_fit(p_profile uuid, p_lead uuid)
 RETURNS TABLE(fits boolean, km numeric, label text, reason text, slot_date date, slot_start time without time zone, minutes int, minutes_source text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE l record; m record; r record; d date; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_now time := (now() AT TIME ZONE 'Africa/Johannesburg')::time; v_last text;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL THEN RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Lead not found', NULL::date, NULL::time, NULL::int, NULL::text; RETURN; END IF;
  SELECT * INTO m FROM public._tech_offer_minutes(p_lead);
  IF l.latitude IS NULL OR l.longitude IS NULL THEN
    RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'No location on lead', NULL::date, NULL::time, m.minutes, m.source; RETURN; END IF;
  IF l.scheduled_date IS NOT NULL AND l.scheduled_time IS NOT NULL THEN
    IF l.scheduled_date + l.scheduled_time < v_today + v_now THEN
      RETURN QUERY SELECT false, NULL::numeric, NULL::text, 'Booked time has passed', l.scheduled_date, l.scheduled_time, m.minutes, m.source; RETURN; END IF;
    SELECT * INTO r FROM public._staff_slot_fit(p_profile, p_lead, l.scheduled_date, l.scheduled_time, m.minutes, l.latitude, l.longitude);
    RETURN QUERY SELECT r.fits, r.km, r.label, r.reason, l.scheduled_date, l.scheduled_time, m.minutes, m.source; RETURN;
  END IF;
  FOR d IN SELECT generate_series(GREATEST(v_today, COALESCE(l.scheduled_date, v_today)), v_today + 6, interval '1 day')::date LOOP
    SELECT * INTO r FROM public._staff_slot_fit(p_profile, p_lead, d, NULL, m.minutes, l.latitude, l.longitude,
      CASE WHEN d = v_today THEN v_now + interval '30 minutes' END);
    IF r.fits THEN RETURN QUERY SELECT true, r.km, r.label, r.reason, d, r.best_start, m.minutes, m.source; RETURN; END IF;
    IF r.reason NOT IN ('Not working that day', 'No free time that day') OR v_last IS NULL THEN v_last := r.reason; END IF;
    EXIT WHEN r.reason = 'No home or office base set';
  END LOOP;
  RETURN QUERY SELECT false, NULL::numeric, NULL::text, COALESCE(v_last, 'No free slot in the next 7 days'), NULL::date, NULL::time, m.minutes, m.source;
END $f$;
REVOKE ALL ON FUNCTION public._tech_offer_fit(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 6) Offers for the caller (technician), nearest first. applies=false for everyone else (the app then shows its normal list).
--    Admin/office may pass p_profile to see a tech's offers incl. the ones that don't fit and why.
CREATE OR REPLACE FUNCTION public.tech_offers(p_profile uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_pid uuid; v_co uuid; v_all boolean := false; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('applies', false, 'offers', '[]'::jsonb); END IF;
  IF p_profile IS NULL OR p_profile = v_uid THEN
    IF NOT public.is_field_tech_only(v_uid) THEN RETURN jsonb_build_object('applies', false, 'offers', '[]'::jsonb); END IF;
    v_pid := v_uid;
  ELSE
    SELECT company_id INTO v_co FROM public.profiles WHERE id = p_profile;
    IF NOT (public.has_role(v_uid, 'admin') OR (public.rh_ops_ok(v_co) AND NOT public.is_sales_rep(v_uid))) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    v_pid := p_profile; v_all := true;
  END IF;
  v_co := public.get_user_company_id(v_pid);
  SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.fits DESC, o.km NULLS LAST), '[]'::jsonb) INTO v_out FROM (
    SELECT l.id AS lead_id, f.fits, f.km, f.label, f.reason, f.slot_date, f.slot_start, f.minutes, f.minutes_source
      FROM public.leads l CROSS JOIN LATERAL public._tech_offer_fit(v_pid, l.id) f
     WHERE l.company_id = v_co AND l.assigned_agent_id IS NULL AND l.status IN ('pending', 'open', 'released')
       AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
       AND COALESCE(l.primary_intent::text, 'service') = 'service'
       AND (v_all OR f.fits)) o;
  RETURN jsonb_build_object('applies', true, 'offers', v_out);
END $f$;
REVOKE ALL ON FUNCTION public.tech_offers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_offers(uuid) TO authenticated;

-- 7) Server-side recheck when a technician claims a lead (stale cards can't double-book).
CREATE OR REPLACE FUNCTION public._tech_claim_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_m int; c record; r record;
BEGIN
  IF v_uid IS NULL OR NEW.assigned_agent_id IS DISTINCT FROM v_uid OR OLD.assigned_agent_id IS NOT DISTINCT FROM v_uid
     OR NOT public.is_field_tech_only(v_uid) THEN RETURN NEW; END IF;
  IF NEW.scheduled_date IS NULL OR NEW.scheduled_time IS NULL THEN
    RAISE EXCEPTION 'Pick a date and time that fits your day before accepting'; END IF;
  v_m := COALESCE(NEW.estimated_duration_minutes, (SELECT minutes FROM public._tech_offer_minutes(NEW.id)), 60);
  -- S2 clash check (overlap or inside the 30-min buffer)
  SELECT * INTO c FROM public.booking_clashes(v_uid, NEW.scheduled_date, NEW.scheduled_time,
    (NEW.scheduled_time + make_interval(mins => v_m))::time, NULL, NEW.id) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This offer no longer fits your day: clashes with % at %', c.label, to_char(c.start_time, 'HH24:MI');
  END IF;
  -- hours, 15 km and travel before/after (same rules as the offer list)
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    SELECT * INTO r FROM public._staff_slot_fit(v_uid, NEW.id, NEW.scheduled_date, NEW.scheduled_time, v_m, NEW.latitude, NEW.longitude);
    IF NOT r.fits THEN RAISE EXCEPTION 'This offer no longer fits your day: %', r.reason; END IF;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_tech_claim_guard ON public.leads;
CREATE TRIGGER trg_tech_claim_guard BEFORE UPDATE OF assigned_agent_id, scheduled_date, scheduled_time, estimated_duration_minutes
  ON public.leads FOR EACH ROW EXECUTE FUNCTION public._tech_claim_guard();
