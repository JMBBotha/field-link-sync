-- Availability: one source of truth (Johan 29 Oct 2026).
-- profiles.availability_status ('available'|'busy'|'offline') is the truth; agent_locations.is_available mirrors it.
-- profiles.availability_choice keeps the person's own last choice so finishing a job restores it.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS availability_choice text;

CREATE OR REPLACE FUNCTION public.staff_is_available(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT availability_status FROM public.profiles WHERE id = p_uid), 'offline') = 'available';
$$;

-- Own status only. p_manual=true: a deliberate tap (also remembered as the choice).
-- 'restore' = back to the remembered choice (job finished).
CREATE OR REPLACE FUNCTION public.set_my_availability(p_status text, p_manual boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_new text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status = 'restore' THEN
    SELECT COALESCE(availability_choice, 'available') INTO v_new FROM public.profiles WHERE id = v_uid;
  ELSIF p_status IN ('available', 'busy', 'offline') THEN v_new := p_status;
  ELSE RAISE EXCEPTION 'bad status %', p_status; END IF;
  UPDATE public.profiles SET availability_status = v_new, last_availability_update = now(),
         availability_choice = CASE WHEN p_manual AND p_status <> 'restore' THEN v_new ELSE availability_choice END
   WHERE id = v_uid;
  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION public.set_my_availability(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public._sync_availability_to_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.agent_locations SET is_available = (NEW.availability_status = 'available')
   WHERE agent_id = NEW.id AND is_available IS DISTINCT FROM (NEW.availability_status = 'available');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_availability_to_location ON public.profiles;
CREATE TRIGGER trg_sync_availability_to_location AFTER INSERT OR UPDATE OF availability_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._sync_availability_to_location();

-- Location rows always follow the profile (a GPS/old-app write can't flip someone to Available).
CREATE OR REPLACE FUNCTION public._location_follows_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.is_available := public.staff_is_available(NEW.agent_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_location_follows_profile ON public.agent_locations;
CREATE TRIGGER trg_location_follows_profile BEFORE INSERT OR UPDATE ON public.agent_locations
  FOR EACH ROW EXECUTE FUNCTION public._location_follows_profile();

-- Backfill: remember current status as the choice; align locations.
UPDATE public.profiles SET availability_choice = COALESCE(availability_status, 'available') WHERE availability_choice IS NULL;
UPDATE public.agent_locations SET last_updated = last_updated;

CREATE OR REPLACE FUNCTION public._tech_offer_fit(p_profile uuid, p_lead uuid)
 RETURNS TABLE(fits boolean, km numeric, label text, reason text, slot_date date, slot_start time without time zone, minutes integer, minutes_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.claim_install_offer(p_offer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); o record; j record; q record; v_name text; v_clash date;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id AND offer_type = 'install';
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Offer not found'); END IF;
  IF o.staff_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok', false, 'message', 'This offer is for someone else'); END IF;
  IF NOT public.staff_is_available(v_uid) THEN RETURN jsonb_build_object('ok', false, 'message', 'Set yourself to Available to take this job'); END IF;
  SELECT * INTO j FROM public.jobs WHERE id = o.job_id FOR UPDATE;
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.offers WHERE job_id = o.job_id AND status = 'accepted')
     OR EXISTS (SELECT 1 FROM public.assignments WHERE job_id = o.job_id AND status <> 'rejected') THEN
    UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE id = p_offer_id AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'message', 'Already taken by another technician');
  END IF;
  IF o.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'message', 'This offer is no longer open'); END IF;
  IF o.respond_by < now() THEN
    UPDATE public.offers SET status = 'expired', responded_at = now() WHERE id = p_offer_id;
    RETURN jsonb_build_object('ok', false, 'message', 'Offer expired');
  END IF;
  -- multi-day: still free on every day?
  SELECT s.scheduled_date INTO v_clash FROM public.job_schedules s
   WHERE s.job_id = o.job_id AND s.day_count > 1
     AND (NOT (SELECT w.is_working FROM public._job_work_day(v_uid, j.company_id, s.scheduled_date) w)
          OR EXISTS (SELECT 1 FROM public._person_bookings(v_uid, s.scheduled_date) b
                      WHERE b.job_id IS DISTINCT FROM o.job_id AND b.start_time < s.end_time AND b.end_time > s.start_time))
   ORDER BY s.scheduled_date LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This job no longer fits your days: you''re busy on ' || to_char(v_clash, 'Dy DD Mon'));
  END IF;
  UPDATE public.offers SET status = 'accepted', responded_at = now() WHERE id = p_offer_id;
  UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = o.job_id AND id <> p_offer_id AND status = 'pending';
  INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
  VALUES (o.job_id, v_uid, 'accepted', 'internal', v_uid);
  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;
  SELECT * INTO q FROM public.quotes WHERE id = j.quote_id;
  IF q.sales_engineer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (q.sales_engineer_id, 'install_offer_taken', 'Installation taken',
            COALESCE(v_name, 'A technician') || ' took the installation for ' || COALESCE(q.customer_name, 'the client'), o.job_id,
            jsonb_build_object('job_id', o.job_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', o.job_id, 'message', 'It''s yours');
END $function$;

CREATE OR REPLACE FUNCTION public.claim_offer(p_offer_id uuid, p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_offer public.offers%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Offer not found');
  END IF;
  IF v_offer.staff_id <> p_staff_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'Offer belongs to another staff member');
  END IF;
  IF NOT public.staff_is_available(p_staff_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Set yourself to Available to take this lead');
  END IF;
  IF v_offer.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Offer is no longer pending');
  END IF;
  IF v_offer.expires_at < now() THEN
    UPDATE public.offers SET status='expired' WHERE id = p_offer_id;
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Offer expired');
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE lead_id = v_offer.lead_id AND status='accepted') THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'This lead has already been claimed');
  END IF;

  UPDATE public.offers
     SET status='accepted', responded_at = now()
   WHERE id = p_offer_id;

  UPDATE public.offers
     SET status='cancelled', responded_at = now()
   WHERE lead_id = v_offer.lead_id AND id <> p_offer_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'lead_id', v_offer.lead_id, 'offer_type', v_offer.offer_type, 'company_id', v_offer.company_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'This lead has already been claimed');
END; $function$;

CREATE OR REPLACE FUNCTION public.dispatchable_technicians(_company_id uuid)
 RETURNS TABLE(profile_id uuid, full_name text, participant_type text, assignment_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT auth.uid() IS NULL                      -- service role (dispatch-job)
        OR public.is_company_member(auth.uid(), _company_id)
        OR public.has_role(auth.uid(), 'platform_super_admin'::app_role) AS ok
  ), techs AS (
    SELECT p.id, p.full_name, p.participant_type, 'internal'::text AS assignment_type, 1 AS pri
    FROM public.company_members cm JOIN public.profiles p ON p.id = cm.user_id
    WHERE cm.company_id = _company_id
    UNION ALL
    SELECT p.id, p.full_name, p.participant_type,
           CASE WHEN a.listed_as_staff THEN 'internal' ELSE 'affiliated' END, 2
    FROM public.agent_affiliations a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.company_id = _company_id AND a.status = 'active'
      AND a.affiliation_type IN ('technical', 'both')
      AND p.participant_type = 'independent_tech' AND p.network_status = 'approved'
  )
  SELECT DISTINCT ON (t.id) t.id, t.full_name, t.participant_type, t.assignment_type
  FROM techs t, allowed
  WHERE allowed.ok
    AND (SELECT p.archived_at FROM public.profiles p WHERE p.id = t.id) IS NULL
    AND COALESCE((SELECT p.dispatch_active FROM public.profiles p WHERE p.id = t.id), true)
    AND public.staff_is_available(t.id)
    AND public.has_role(t.id, 'field_agent'::app_role)
    AND NOT public.has_role(t.id, 'admin'::app_role)
    AND NOT public.has_role(t.id, 'dispatcher'::app_role)
    AND NOT public.is_company_admin(t.id, _company_id)
    AND COALESCE((SELECT p.dispatch_role FROM public.profiles p WHERE p.id = t.id), 'technician') = 'technician'
  ORDER BY t.id, t.pri;
$function$;

CREATE OR REPLACE FUNCTION public.process_install_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_n int := 0; v_new int;
BEGIN
  UPDATE public.offers SET status = 'expired', responded_at = now()
   WHERE offer_type = 'install' AND status = 'pending' AND respond_by < now();
  FOR r IN SELECT o.job_id, max(o.sequence) AS seq FROM public.offers o
     WHERE o.offer_type = 'install' AND o.job_id IS NOT NULL GROUP BY o.job_id
     HAVING bool_and(o.status <> 'pending') AND bool_and(o.status <> 'accepted')
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.assignments WHERE job_id = r.job_id AND status <> 'rejected');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications WHERE type = 'install_offer_unclaimed' AND related_id = r.job_id);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.jobs WHERE id = r.job_id AND status IN ('cancelled', 'completed'));
    v_new := 0;
    IF r.seq < 2 THEN v_new := public._p3_offer_round(r.job_id, 2); END IF;
    IF v_new = 0 THEN PERFORM public._p3_notify_unclaimed(r.job_id); END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.rep_offerable_leads()
 RETURNS TABLE(lead_id uuid, km numeric, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id, f.km, f.label
    FROM public.leads l CROSS JOIN LATERAL public._rep_lead_fit(auth.uid(), l.id) f
   WHERE auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())
     AND public.staff_is_available(auth.uid())
     AND l.company_id = public.get_user_company_id(auth.uid())
     AND l.assigned_agent_id IS NULL AND l.status = 'pending'
     AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND COALESCE(l.primary_intent::text, 'sales') = 'sales'
     AND NOT public._same_client_booked(l.id)
     AND f.fits
   ORDER BY f.km NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.tech_offers(p_profile uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Busy/Off: no offers (Johan 29 Oct 2026). Admin preview (v_all) still sees the list.
  IF NOT v_all AND NOT public.staff_is_available(v_pid) THEN
    RETURN jsonb_build_object('applies', true, 'offers', '[]'::jsonb, 'unavailable', true); END IF;
  v_co := public.get_user_company_id(v_pid);
  SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.fits DESC, o.km NULLS LAST), '[]'::jsonb) INTO v_out FROM (
    SELECT l.id AS lead_id, f.fits, f.km, f.label, f.reason, f.slot_date, f.slot_start, f.minutes, f.minutes_source
      FROM public.leads l CROSS JOIN LATERAL public._tech_offer_fit(v_pid, l.id) f
     WHERE l.company_id = v_co AND l.assigned_agent_id IS NULL AND l.status IN ('pending', 'open', 'released')
       AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
       AND COALESCE(l.primary_intent::text, 'service') = 'service'
       AND NOT public._same_client_booked(l.id)
       AND (v_all OR f.fits)) o;
  RETURN jsonb_build_object('applies', true, 'offers', v_out);
END $function$;

CREATE OR REPLACE FUNCTION public._p3_offer_round(p_job uuid, p_round integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_full int; v_local timestamp; d date; t time; v_min int; v_fit_min int; v_radius numeric; p record; f record;
  v_n int := 0; v_body text; v_oid uuid; v_by timestamptz := now() + interval '15 minutes';
  v_days int; dd record; w record; v_ok boolean;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL OR j.lead_id IS NULL OR j.scheduled_for IS NULL THEN RETURN 0; END IF;
  v_local := j.scheduled_for AT TIME ZONE 'Africa/Johannesburg'; d := v_local::date; t := v_local::time;
  v_min := GREATEST(COALESCE((extract(epoch FROM j.estimated_duration) / 60)::int, 180), 30);
  -- "Full day" = the company's working hours (default 08:00-17:00 = 9 h)
  SELECT GREATEST((extract(epoch FROM (c.work_end - c.work_start)) / 60)::int, 60) INTO v_full
    FROM public.companies c WHERE c.id = j.company_id AND c.work_end > c.work_start;
  v_full := COALESCE(v_full, 540);
  v_fit_min := LEAST(v_min, v_full);
  v_radius := 50 * GREATEST(p_round, 1);
  v_body := concat_ws(' · ', public._p3_suburb(j.address), to_char(d, 'Dy DD Mon') || ' ' || to_char(t, 'HH24:MI'),
    CASE WHEN v_min = v_full THEN 'Full day' WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h' ELSE round(v_min / 60.0, 1)::text || ' h' END);
  -- multi-day run: offer only to techs who are working and free on every day of it
  v_days := COALESCE((SELECT max(day_count) FROM public.job_schedules WHERE job_id = p_job), 1);
  IF v_days > 1 THEN
    v_body := concat_ws(' · ', public._p3_suburb(j.address),
      v_days || ' days from ' || to_char(d, 'Dy DD Mon') || ' to ' || to_char((j.scheduled_until AT TIME ZONE 'Africa/Johannesburg')::date, 'Dy DD Mon'),
      'Full days');
  END IF;
  FOR p IN SELECT pr.id FROM public.profiles pr WHERE public._p3_is_tech(pr.id, j.company_id)
     AND public.staff_is_available(pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.offers o WHERE o.job_id = p_job AND o.staff_id = pr.id AND o.status IN ('declined', 'pending'))
  LOOP
    IF v_days > 1 THEN
      v_ok := true;
      FOR dd IN SELECT s.scheduled_date, s.start_time, s.end_time FROM public.job_schedules s WHERE s.job_id = p_job ORDER BY s.scheduled_date LOOP
        SELECT * INTO w FROM public._job_work_day(p.id, j.company_id, dd.scheduled_date);
        IF NOT w.is_working OR EXISTS (SELECT 1 FROM public._person_bookings(p.id, dd.scheduled_date) b
             WHERE b.job_id IS DISTINCT FROM p_job AND b.start_time < dd.end_time AND b.end_time > dd.start_time) THEN
          v_ok := false; EXIT;
        END IF;
      END LOOP;
      CONTINUE WHEN NOT v_ok;
      SELECT * INTO f FROM public._staff_slot_fit(p.id, j.lead_id, d, t, 5, j.lat, j.lng, NULL);  -- distance only
      IF f.km IS NOT NULL AND f.km > v_radius THEN CONTINUE; END IF;
    ELSE
    SELECT * INTO f FROM public._staff_slot_fit(p.id, j.lead_id, d, t, v_fit_min, j.lat, j.lng, NULL);
    IF NOT COALESCE(f.fits, false) THEN
      IF f.reason IN ('Busy at that time', 'Outside working hours', 'Not working that day', 'No free time that day',
                      'Not enough travel time', 'No time to reach the next job') THEN CONTINUE; END IF;
      IF f.km IS NOT NULL AND f.km > v_radius THEN CONTINUE; END IF;
    END IF;
    END IF;
    INSERT INTO public.offers (lead_id, job_id, staff_id, company_id, offer_type, sequence, status, distance_km, expires_at, respond_by)
    VALUES (j.lead_id, p_job, p.id, j.company_id, 'install', p_round, 'pending', f.km, '2999-01-01'::timestamptz, v_by)
    RETURNING id INTO v_oid;
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (p.id, 'install_offer', 'Installation offer', v_body, p_job,
            jsonb_build_object('offer_id', v_oid, 'job_id', p_job, 'respond_by', v_by, 'link', '/field'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
