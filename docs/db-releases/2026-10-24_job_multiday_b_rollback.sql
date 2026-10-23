-- ROLLBACK for 20261024100000_job_multiday_b.sql
-- Order matters: collapse runs to day 1 first, then remove day data, restore old functions, drop new objects/columns.
SELECT set_config('app.job_days_writing', '1', true);

-- 1) multi-day runs -> single booking on day 1 (length of day 1)
DELETE FROM public.job_schedules WHERE day_index > 1;
UPDATE public.jobs j SET estimated_duration = (s.end_time - s.start_time)
  FROM public.job_schedules s WHERE s.job_id = j.id AND s.day_index = 1 AND j.scheduled_until IS NOT NULL;
UPDATE public.job_schedules SET day_index = NULL, day_count = NULL WHERE day_index IS NOT NULL;

-- 2) day data
DELETE FROM public.job_time_entries WHERE job_id IS NOT NULL;
DELETE FROM public.job_alerts WHERE work_date IS NOT NULL;

-- 3) triggers + new functions
DROP TRIGGER IF EXISTS trg_job_days_on_complete ON public.jobs;
DROP TRIGGER IF EXISTS trg_job_completions_00_day_labour ON public.job_completions;
DROP TRIGGER IF EXISTS trg_job_completions_01_photos_signoff ON public.job_completions;
DROP FUNCTION IF EXISTS public.job_completion_photos_signoff();
-- restore the tech completion merge (pre-image)
CREATE OR REPLACE FUNCTION public.job_completions_rh_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE u uuid := auth.uid();
BEGIN
  -- techs cannot SELECT job_completions (cost), so ON CONFLICT upserts fail for them; merge here instead
  IF pg_trigger_depth() > 1 OR NEW.lead_id IS NULL OR u IS NULL OR NOT public.is_field_tech_only(u) THEN RETURN NEW; END IF;
  IF NEW.technician_id IS DISTINCT FROM u OR NOT public.tech_can_see_lead(u, NEW.lead_id)
     OR (NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM public.caller_company_id()) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.job_completions SET job_id = NEW.job_id, work_summary = NEW.work_summary, customer_name = NEW.customer_name,
    customer_email = NEW.customer_email, signature_data_url = NEW.signature_data_url, signed_at = NEW.signed_at,
    labour_minutes = NEW.labour_minutes, photo_count = NEW.photo_count, status = NEW.status, completed_at = NEW.completed_at
  WHERE lead_id = NEW.lead_id AND technician_id = u;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.job_completions WHERE lead_id = NEW.lead_id) THEN
      RAISE EXCEPTION 'Completion already recorded by another technician' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.job_completions SELECT NEW.*;
  END IF;
  RETURN NULL;
END $function$;
DROP FUNCTION IF EXISTS public.job_days_on_complete();
DROP FUNCTION IF EXISTS public.job_completion_day_labour();
DROP FUNCTION IF EXISTS public.job_day_en_route_plan(uuid, date);
DROP FUNCTION IF EXISTS public.job_add_day(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.tech_done_for_today(uuid, numeric, text, text, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public._job_after_photos(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.tech_check_in(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.tech_day_en_route(uuid, timestamptz);
DROP FUNCTION IF EXISTS public._job_day_time(timestamptz);
DROP FUNCTION IF EXISTS public._job_day_actor(uuid);
DROP FUNCTION IF EXISTS public.job_day_states(date, date);
DROP FUNCTION IF EXISTS public.job_days(uuid);
DROP FUNCTION IF EXISTS public.schedule_job_days(uuid, uuid, date, integer, date, boolean, boolean, text);
DROP FUNCTION IF EXISTS public.preview_job_days(uuid, date, integer, date, uuid);

-- 4) restore previous versions (bodies as live on 2026-10-23)
DROP FUNCTION IF EXISTS public.hand_to_technician(uuid, date, time without time zone, integer, text, uuid, integer, boolean, text);
CREATE OR REPLACE FUNCTION public.hand_to_technician(p_quote_id uuid, p_date date, p_start time without time zone, p_minutes integer, p_mode text, p_tech_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; q record; v_inv uuid; j record; v_job uuid; v_addr text; v_lat double precision; v_lng double precision;
  v_for timestamptz; v_end time; v_n int; v_tname text;
BEGIN
  IF p_mode NOT IN ('pick', 'offer') THEN RAISE EXCEPTION 'Choose Pick technician or Offer to technicians'; END IF;
  IF p_date IS NULL OR p_start IS NULL THEN RAISE EXCEPTION 'Date and start time are required'; END IF;
  IF p_minutes IS NULL OR p_minutes < 30 THEN RAISE EXCEPTION 'Duration must be at least 30 minutes'; END IF;
  IF extract(epoch FROM p_start)::int / 60 + p_minutes > 23 * 60 + 59 THEN
    RAISE EXCEPTION 'The job can''t run past midnight — pick a shorter length'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  v_role := public._p3_handoff_role(v_uid, p_quote_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'You can''t hand over this quote' USING ERRCODE = '42501'; END IF;
  IF v_role = 'rep' AND p_mode = 'pick' THEN
    RAISE EXCEPTION 'Salespeople can''t assign technicians — use Offer to technicians' USING ERRCODE = '42501'; END IF;
  IF lower(COALESCE(q.status, '')) <> 'accepted' THEN RAISE EXCEPTION 'Quote is not accepted'; END IF;
  SELECT id INTO v_inv FROM public.invoices WHERE quote_id = q.id ORDER BY created_at LIMIT 1;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Deposit invoice required first'; END IF;
  IF p_mode = 'offer' AND q.lead_id IS NULL THEN RAISE EXCEPTION 'This quote has no lead, so it can''t be offered — pick a technician'; END IF;
  IF p_mode = 'pick' AND NOT public._p3_is_tech(p_tech_id, q.company_id) THEN RAISE EXCEPTION 'Pick an active technician in your company'; END IF;

  SELECT * INTO j FROM public.jobs WHERE quote_id = q.id AND job_type = 'installation' ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF j.id IS NOT NULL THEN
    SELECT pr.full_name INTO v_tname FROM public.assignments a JOIN public.profiles pr ON pr.id = a.profile_id
     WHERE a.job_id = j.id AND a.status <> 'rejected' LIMIT 1;
    IF v_tname IS NOT NULL OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = j.id AND a.status <> 'rejected') THEN
      RETURN jsonb_build_object('ok', false, 'job_id', j.id, 'message', 'Already handed over to ' || COALESCE(v_tname, 'a technician'));
    END IF;
    IF EXISTS (SELECT 1 FROM public.offers WHERE job_id = j.id AND status = 'pending' AND respond_by > now()) THEN
      IF p_mode = 'offer' OR v_role = 'rep' THEN
        RETURN jsonb_build_object('ok', false, 'job_id', j.id, 'message', 'Already offered to technicians — waiting for someone to accept');
      END IF;
      UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = j.id AND status = 'pending';
    END IF;
  END IF;

  IF q.lead_id IS NOT NULL THEN
    SELECT customer_address, latitude, longitude INTO v_addr, v_lat, v_lng FROM public.leads WHERE id = q.lead_id;
  END IF;
  IF (v_addr IS NULL OR v_lat IS NULL) AND q.customer_id IS NOT NULL THEN
    SELECT COALESCE(v_addr, c.address), COALESCE(v_lat, c.latitude), COALESCE(v_lng, c.longitude) INTO v_addr, v_lat, v_lng
      FROM public.customers c WHERE c.id = q.customer_id;
  END IF;
  v_for := (p_date + p_start) AT TIME ZONE 'Africa/Johannesburg';
  v_end := (LEAST(extract(epoch FROM p_start)::int / 60 + p_minutes, 23 * 60 + 59) * interval '1 minute')::time;

  IF j.id IS NULL THEN
    INSERT INTO public.jobs (company_id, customer_id, lead_id, quote_id, invoice_id, job_type, status, title, description,
                             address, lat, lng, scheduled_for, estimated_duration, created_by)
    VALUES (q.company_id, q.customer_id, q.lead_id, q.id, v_inv, 'installation', 'scheduled',
            'Installation — ' || COALESCE(q.customer_name, 'Customer'),
            btrim('Installation from accepted quote ' || COALESCE(q.quote_number, '')),
            v_addr, v_lat, v_lng, v_for, make_interval(mins => p_minutes), v_uid)
    RETURNING id INTO v_job;
  ELSE
    v_job := j.id;
    UPDATE public.jobs SET scheduled_for = v_for, estimated_duration = make_interval(mins => p_minutes),
           lat = COALESCE(lat, v_lat), lng = COALESCE(lng, v_lng), address = COALESCE(address, v_addr), updated_at = now()
     WHERE id = v_job;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = v_job) AND q.lead_id IS NOT NULL THEN
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (q.lead_id, v_job, NULL, p_date, p_start, v_end, btrim('Installation — quote ' || COALESCE(q.quote_number, '')));
  ELSE
    UPDATE public.job_schedules SET scheduled_date = p_date, start_time = p_start, end_time = v_end, updated_at = now() WHERE job_id = v_job;
  END IF;

  IF p_mode = 'pick' THEN
    INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
    VALUES (v_job, p_tech_id, 'accepted', 'internal', v_uid);
    SELECT full_name INTO v_tname FROM public.profiles WHERE id = p_tech_id;
    RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'pick', 'message', 'Handed to ' || COALESCE(v_tname, 'technician'));
  END IF;

  v_n := public._p3_offer_round(v_job, 1);
  IF v_n = 0 THEN
    PERFORM public._p3_notify_unclaimed(v_job);
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'offer', 'offered', v_n,
    'message', CASE WHEN v_n = 0 THEN 'No technician is free then — the office has been asked to pick one'
                    ELSE 'Offered to ' || v_n || ' technician' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' — first to accept gets it' END);
END $function$;
REVOKE ALL ON FUNCTION public.hand_to_technician(uuid, date, time without time zone, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hand_to_technician(uuid, date, time without time zone, integer, text, uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.sync_job_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_local timestamp; v_dur interval;
BEGIN
  IF NEW.scheduled_for IS NULL THEN RETURN NEW; END IF;
  v_local := NEW.scheduled_for AT TIME ZONE 'Africa/Johannesburg';
  v_dur := COALESCE(NEW.estimated_duration, interval '3 hours');
  UPDATE public.job_schedules
     SET scheduled_date = v_local::date, start_time = v_local::time, end_time = public.booking_end_time(v_local::time, v_dur), updated_at = now()
   WHERE job_id = NEW.id
     AND (scheduled_date IS DISTINCT FROM v_local::date OR start_time IS DISTINCT FROM v_local::time
          OR end_time IS DISTINCT FROM public.booking_end_time(v_local::time, v_dur));
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.notify_job_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_customer text;
  v_title text;
  v_body text;
BEGIN
  SELECT l.company_id, COALESCE(l.customer_name, 'Customer')
    INTO v_company, v_customer
  FROM public.leads l WHERE l.id = NEW.lead_id;

  IF TG_OP = 'INSERT' THEN
    v_title := 'Job Scheduled';
  ELSE
    IF NEW.scheduled_date IS NOT DISTINCT FROM OLD.scheduled_date
       AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
       AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id THEN
      RETURN NEW;
    END IF;
    v_title := 'Job Rescheduled';
  END IF;

  v_body := v_customer || ' - ' || to_char(NEW.scheduled_date, 'DD Mon YYYY')
            || ' at ' || to_char(NEW.start_time::time, 'HH24:MI')
            || COALESCE(' with ' || (SELECT p.full_name FROM public.profiles p WHERE p.id = NEW.agent_id), '');

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  SELECT DISTINCT u.user_id, 'job_schedule', v_title, v_body, NEW.lead_id
  FROM (
    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('admin', 'dispatcher')
      AND (v_company IS NULL OR p.company_id = v_company)
    UNION
    SELECT NEW.agent_id
  ) u
  WHERE u.user_id IS NOT NULL;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public._p3_offer_round(p_job uuid, p_round integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_full int; v_local timestamp; d date; t time; v_min int; v_fit_min int; v_radius numeric; p record; f record;
  v_n int := 0; v_body text; v_oid uuid; v_by timestamptz := now() + interval '15 minutes';
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
  FOR p IN SELECT pr.id FROM public.profiles pr WHERE public._p3_is_tech(pr.id, j.company_id)
     AND NOT EXISTS (SELECT 1 FROM public.offers o WHERE o.job_id = p_job AND o.staff_id = pr.id AND o.status IN ('declined', 'pending'))
  LOOP
    SELECT * INTO f FROM public._staff_slot_fit(p.id, j.lead_id, d, t, v_fit_min, j.lat, j.lng, NULL);
    IF NOT COALESCE(f.fits, false) THEN
      IF f.reason IN ('Busy at that time', 'Outside working hours', 'Not working that day', 'No free time that day',
                      'Not enough travel time', 'No time to reach the next job') THEN CONTINUE; END IF;
      IF f.km IS NOT NULL AND f.km > v_radius THEN CONTINUE; END IF;
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
CREATE OR REPLACE FUNCTION public.my_install_offers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'offer_id', o.id, 'job_id', o.job_id,
    'client', split_part(btrim(COALESCE(l.customer_name, 'Client')), ' ', 1),
    'suburb', public._p3_suburb(j.address),
    'date', ((j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date),
    'start', to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'),
    'minutes', (extract(epoch FROM j.estimated_duration) / 60)::int,
    'distance_km', o.distance_km, 'respond_by', o.respond_by) ORDER BY o.respond_by), '[]'::jsonb)
  FROM public.offers o JOIN public.jobs j ON j.id = o.job_id LEFT JOIN public.leads l ON l.id = o.lead_id
  WHERE o.staff_id = auth.uid() AND o.offer_type = 'install' AND o.status = 'pending' AND o.respond_by > now();
$function$;
CREATE OR REPLACE FUNCTION public.claim_install_offer(p_offer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); o record; j record; q record; v_name text;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id AND offer_type = 'install';
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Offer not found'); END IF;
  IF o.staff_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok', false, 'message', 'This offer is for someone else'); END IF;
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
CREATE OR REPLACE FUNCTION public.job_watchdog_scan()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_new integer := 0; v_id uuid; v_hhmm text; c public.job_watch_settings; v_plan jsonb; v_leave timestamptz;
  v_rule text; v_sev text; v_msg text; v_tech_msg text; v_meta jsonb;
BEGIN
  UPDATE job_alerts a SET resolved_at = now(), resolution = 'auto: cleared'
  FROM jobs j
  WHERE a.job_id = j.id AND a.resolved_at IS NULL AND (
    j.status IN ('completed','cancelled')
    OR (a.rule IN ('not_accepted','not_accepted_urgent') AND NOT EXISTS (SELECT 1 FROM assignments x WHERE x.job_id = j.id AND x.status = 'proposed'))
    OR (a.rule = 'not_started' AND j.started_at IS NOT NULL)
    OR (a.rule = 'no_en_route' AND (j.started_at IS NOT NULL OR j.status <> 'scheduled' OR j.en_route_at IS NOT NULL))
    OR (a.rule = 'not_finished' AND j.completed_at IS NOT NULL));
  -- once a job is late, the late alert replaces its at-risk alert (one card per job)
  UPDATE job_alerts a SET resolved_at = now(), resolution = 'auto: now late'
  WHERE a.rule = 'no_en_route' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM job_alerts b WHERE b.job_id = a.job_id AND b.rule = 'not_started' AND b.resolved_at IS NULL);

  FOR r IN
    SELECT j.id, j.company_id, j.title, j.scheduled_for, j.status, j.started_at, j.estimated_duration, j.en_route_at,
           s.profile_id, s.status AS astatus, s.created_at AS assigned_at,
           CASE WHEN s.profile_id IS NULL THEN NULL ELSE coalesce(p.full_name,'Technician') END AS tech
    FROM jobs j
    LEFT JOIN LATERAL (SELECT * FROM assignments x WHERE x.job_id = j.id AND coalesce(x.status,'') <> 'rejected'
                       ORDER BY x.created_at DESC LIMIT 1) s ON true
    LEFT JOIN profiles p ON p.id = s.profile_id
    WHERE j.status NOT IN ('completed','cancelled') AND j.completed_at IS NULL AND j.scheduled_for IS NOT NULL
      AND j.scheduled_for > now() - interval '2 days' AND j.scheduled_for < now() + interval '2 days'
  LOOP
    v_rule := NULL; v_sev := 'warning'; v_tech_msg := NULL; v_meta := '{}'::jsonb;
    c := public.job_watch_cfg(r.company_id);
    v_hhmm := to_char(r.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI');
    IF r.astatus = 'proposed' AND r.scheduled_for <= now() + interval '60 minutes' THEN
      v_rule := 'not_accepted_urgent'; v_sev := 'critical';
      v_msg := r.tech || ' has not accepted "' || r.title || '" (' || v_hhmm || '). Call or reassign.';
    ELSIF r.astatus = 'proposed' AND (r.assigned_at < now() - interval '2 hours'
          OR now() > (((r.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date - 1) + time '17:00') AT TIME ZONE 'Africa/Johannesburg') THEN
      v_rule := 'not_accepted';
      v_msg := r.tech || ' has not accepted "' || r.title || '" (' || v_hhmm || ').';
      v_tech_msg := 'Please accept or decline "' || r.title || '" on ' || v_hhmm || '.';
    ELSIF r.started_at IS NULL AND now() > r.scheduled_for + make_interval(mins => c.late_checkin_minutes) THEN
      v_rule := 'not_started'; v_sev := 'critical';
      v_msg := 'Late: "' || r.title || '" (' || v_hhmm || ') – '
        || CASE WHEN r.tech IS NULL THEN 'no technician assigned and nobody has checked in'
                ELSE r.tech || ' has not checked in' END
        || ' ' || c.late_checkin_minutes || ' min after the booked start.';
      v_meta := jsonb_build_object('late_minutes', c.late_checkin_minutes);
    ELSIF r.tech IS NOT NULL AND r.status = 'scheduled' AND r.started_at IS NULL AND r.en_route_at IS NULL THEN
      v_plan := public.job_en_route_plan(r.id);
      v_leave := (v_plan->>'leave_by')::timestamptz;
      IF v_leave IS NOT NULL AND now() >= v_leave THEN
        v_rule := 'no_en_route';
        v_msg := 'At risk: ' || r.tech || ' is not en route for "' || r.title || '" (' || v_hhmm || '). Should have left by '
          || to_char(v_leave AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || ' ('
          || CASE WHEN (v_plan->>'fallback')::boolean THEN 'no drive estimate, ' || (v_plan->>'lead_minutes') || '-min default'
                  ELSE 'drive ~' || (v_plan->>'drive_minutes') || ' min from ' || (v_plan->>'drive_from') END || ').';
        v_tech_msg := 'Tap "En route" when you leave for "' || r.title || '" (' || v_hhmm || '). Leave by '
          || to_char(v_leave AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || '.';
        v_meta := v_plan;
      END IF;
    ELSIF r.started_at IS NOT NULL AND now() > r.scheduled_for + coalesce(r.estimated_duration, interval '3 hours') + interval '1 hour' THEN
      v_rule := 'not_finished';
      v_msg := '"' || r.title || '" (' || v_hhmm || ') is running over and not marked done by ' || coalesce(r.tech, 'the technician') || '.';
      v_tech_msg := 'Please mark "' || r.title || '" as done when finished.';
    END IF;
    CONTINUE WHEN v_rule IS NULL;
    v_id := NULL;
    INSERT INTO job_alerts (company_id, job_id, profile_id, rule, severity, message)
    VALUES (r.company_id, r.id, r.profile_id, v_rule, v_sev, v_msg)
    ON CONFLICT (job_id, rule) DO NOTHING RETURNING id INTO v_id;
    CONTINUE WHEN v_id IS NULL;
    v_new := v_new + 1;
    INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
    SELECT p.id, 'job_watchdog',
           CASE WHEN v_rule = 'not_started' THEN 'Late: tech not checked in'
                WHEN v_rule = 'no_en_route' THEN 'At risk: tech not en route'
                WHEN v_sev='critical' THEN 'Urgent: job needs attention' ELSE 'Job needs attention' END,
           v_msg, r.id, jsonb_build_object('rule', v_rule, 'alert_id', v_id, 'severity', v_sev) || v_meta
    FROM profiles p WHERE p.company_id = r.company_id
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin','dispatcher'));
    IF v_tech_msg IS NOT NULL AND r.profile_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
      VALUES (r.profile_id, 'job_watchdog', 'Reminder', v_tech_msg, r.id, jsonb_build_object('rule', v_rule));
    END IF;
  END LOOP;
  RETURN v_new;
END $function$;

DROP FUNCTION IF EXISTS public._job_days_apply(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._job_days_plan(uuid, uuid, uuid, date, integer, date, boolean);
DROP FUNCTION IF EXISTS public._job_work_day(uuid, uuid, date);
DROP FUNCTION IF EXISTS public._holiday_on(uuid, date);

CREATE OR REPLACE FUNCTION public.draft_client_job_message(p_job_id uuid, p_channel text, p_alert_id uuid DEFAULT NULL::uuid)
 RETURNS job_client_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; m public.job_client_messages; v_plan jsonb; v_first text; v_eta text; v_late boolean; v_when text;
BEGIN
  IF p_channel NOT IN ('email','sms') THEN RAISE EXCEPTION 'Channel must be email or SMS'; END IF;
  SELECT jb.id, jb.company_id, jb.title, jb.scheduled_for, jb.started_at, jb.en_route_at, co.name AS company,
         coalesce(cu.first_name, split_part(coalesce(cu.name, l.customer_name, ''), ' ', 1)) AS first_name,
         coalesce(cu.email, l.email) AS email, coalesce(nullif(cu.phone, ''), nullif(l.customer_phone, ''), l.phone) AS phone,
         (SELECT pr.full_name FROM assignments a JOIN profiles pr ON pr.id = a.profile_id
           WHERE a.job_id = jb.id AND coalesce(a.status,'') <> 'rejected' ORDER BY a.created_at DESC LIMIT 1) AS tech
    INTO j FROM jobs jb JOIN companies co ON co.id = jb.company_id
    LEFT JOIN customers cu ON cu.id = jb.customer_id LEFT JOIN leads l ON l.id = jb.lead_id
   WHERE jb.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT public._job_alert_office(auth.uid(), j.company_id) THEN RAISE EXCEPTION 'Office only' USING ERRCODE = '42501'; END IF;
  -- reuse an open draft for the same job + channel
  SELECT * INTO m FROM job_client_messages WHERE job_id = p_job_id AND channel = p_channel AND status = 'draft'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN m; END IF;
  v_plan := public.job_en_route_plan(p_job_id);
  v_when := to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');
  v_late := now() > j.scheduled_for;
  -- best guess arrival: en route time + drive estimate; else leave it for the office to fill in
  IF j.en_route_at IS NOT NULL AND (v_plan->>'drive_minutes') IS NOT NULL THEN
    v_eta := to_char((greatest(now(), j.en_route_at + make_interval(mins => (v_plan->>'drive_minutes')::int))
                      AT TIME ZONE 'Africa/Johannesburg'), 'HH24:MI');
  END IF;
  INSERT INTO job_client_messages (company_id, job_id, alert_id, channel, to_address, subject, body)
  VALUES (j.company_id, p_job_id, p_alert_id, p_channel,
    CASE WHEN p_channel = 'email' THEN j.email ELSE j.phone END,
    CASE WHEN p_channel = 'email' THEN 'Update on your ' || v_when || ' appointment – ' || j.company END,
    'Hi' || coalesce(' ' || nullif(j.first_name, ''), '') || ', this is ' || j.company || '. '
      || coalesce(split_part(j.tech, ' ', 1), 'Our technician') || ' is running '
      || CASE WHEN v_late THEN 'late' ELSE 'a little behind' END || ' for your ' || v_when || ' appointment ' || CASE WHEN (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date = (now() AT TIME ZONE 'Africa/Johannesburg')::date
                     THEN 'today' ELSE 'on ' || to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon') END || '. '
      || CASE WHEN v_eta IS NOT NULL THEN 'Expected arrival is around ' || v_eta || '. '
              ELSE 'We expect to arrive around [time]. ' END
      || 'Sorry for the inconvenience – please reply if that no longer suits you.')
  RETURNING * INTO m;
  RETURN m;
END $function$;

-- 5) constraints / columns
ALTER TABLE public.job_alerts DROP CONSTRAINT IF EXISTS job_alerts_job_rule_day_key;
ALTER TABLE public.job_alerts ADD CONSTRAINT job_alerts_job_id_rule_key UNIQUE (job_id, rule);
ALTER TABLE public.job_alerts DROP COLUMN IF EXISTS work_date;
ALTER TABLE public.job_completions DROP COLUMN IF EXISTS tech_signoff_name, DROP COLUMN IF EXISTS tech_signoff_at,
  DROP COLUMN IF EXISTS tech_signature_data_url, DROP COLUMN IF EXISTS after_photo_count;
DROP TABLE IF EXISTS public.job_rule_rollouts;
DROP INDEX IF EXISTS public.job_time_entries_job_day_key;
ALTER TABLE public.job_time_entries DROP COLUMN IF EXISTS signed_off_at, DROP COLUMN IF EXISTS signed_off_by, DROP COLUMN IF EXISTS signed_off_name,
  DROP COLUMN IF EXISTS tech_signature_data_url, DROP COLUMN IF EXISTS client_name, DROP COLUMN IF EXISTS client_signature_data_url,
  DROP COLUMN IF EXISTS after_photo_count, DROP COLUMN IF EXISTS hours_edit_note, DROP COLUMN IF EXISTS hours_auto, DROP COLUMN IF EXISTS hours_worked,
  DROP COLUMN IF EXISTS checked_out_at, DROP COLUMN IF EXISTS checked_in_at, DROP COLUMN IF EXISTS en_route_at,
  DROP COLUMN IF EXISTS schedule_id, DROP COLUMN IF EXISTS job_id;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS scheduled_until;
DROP INDEX IF EXISTS public.job_schedules_job_day_idx;
ALTER TABLE public.job_schedules DROP CONSTRAINT IF EXISTS job_schedules_day_chk;
ALTER TABLE public.job_schedules DROP COLUMN IF EXISTS day_count, DROP COLUMN IF EXISTS day_index;

-- 6) holidays
DROP TABLE IF EXISTS public.public_holidays;
SELECT set_config('app.job_days_writing', '', true);
