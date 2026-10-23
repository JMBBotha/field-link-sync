-- Rollback for job duration phase (a): restores definitions as of 23 Oct 2026 ~16:00 SAST

ALTER TABLE public.jobs ALTER COLUMN estimated_duration SET DEFAULT '02:00:00'::interval;

CREATE OR REPLACE FUNCTION public.default_booking_minutes(p_kind text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_kind,'')) LIKE '%install%' THEN 210
    WHEN lower(coalesce(p_kind,'')) LIKE '%repair%' THEN 150
    WHEN lower(coalesce(p_kind,'')) IN ('sales','quote','sales_visit','quote_visit','consultation') THEN 60
    WHEN lower(coalesce(p_kind,'')) LIKE '%service%' OR lower(coalesce(p_kind,'')) LIKE '%maint%' THEN 120
    ELSE 60 END;
$function$
;

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
  v_dur := COALESCE(NEW.estimated_duration, interval '2 hours');
  UPDATE public.job_schedules
     SET scheduled_date = v_local::date, start_time = v_local::time, end_time = (v_local + v_dur)::time, updated_at = now()
   WHERE job_id = NEW.id
     AND (scheduled_date IS DISTINCT FROM v_local::date OR start_time IS DISTINCT FROM v_local::time
          OR end_time IS DISTINCT FROM (v_local + v_dur)::time);
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_assignment_to_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_job record; v_local timestamp; v_dur interval;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF v_job.id IS NULL OR v_job.scheduled_for IS NULL OR v_job.lead_id IS NULL THEN RETURN NEW; END IF;
  v_local := v_job.scheduled_for AT TIME ZONE 'Africa/Johannesburg';
  v_dur := COALESCE(v_job.estimated_duration, interval '2 hours');
  UPDATE public.leads SET assigned_agent_id = NEW.profile_id, last_activity_at = now()
   WHERE id = v_job.lead_id AND assigned_agent_id IS NULL AND scheduled_date IS NULL
     AND COALESCE(v_job.job_type,'') <> 'installation';
  IF EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = NEW.job_id) THEN
    UPDATE public.job_schedules SET agent_id = NEW.profile_id, updated_at = now()
     WHERE job_id = NEW.job_id AND agent_id IS DISTINCT FROM NEW.profile_id;
  ELSE
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (v_job.lead_id, NEW.job_id, NEW.profile_id, v_local::date, v_local::time, (v_local + v_dur)::time, v_job.description);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_lead_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_dur interval; v_start time;
BEGIN
  IF NEW.status IN ('completed','cancelled') OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM public.job_schedules WHERE lead_id = NEW.id AND job_id IS NULL ORDER BY created_at ASC LIMIT 1;
  IF NEW.scheduled_date IS NULL OR NEW.assigned_agent_id IS NULL THEN
    IF r.id IS NOT NULL THEN DELETE FROM public.job_schedules WHERE id = r.id; END IF;
    RETURN NEW;
  END IF;
  v_dur := COALESCE(CASE WHEN r.id IS NOT NULL AND r.end_time > r.start_time THEN r.end_time - r.start_time END,
                    make_interval(mins => NEW.estimated_duration_minutes), interval '2 hours');
  v_start := COALESCE(NEW.scheduled_time, r.start_time, '08:00'::time);
  IF r.id IS NULL THEN
    INSERT INTO public.job_schedules (lead_id, agent_id, scheduled_date, start_time, end_time)
    VALUES (NEW.id, NEW.assigned_agent_id, NEW.scheduled_date, v_start, v_start + v_dur);
  ELSIF r.scheduled_date IS DISTINCT FROM NEW.scheduled_date OR r.start_time IS DISTINCT FROM v_start
        OR r.agent_id IS DISTINCT FROM NEW.assigned_agent_id THEN
    UPDATE public.job_schedules SET scheduled_date = NEW.scheduled_date, start_time = v_start,
           end_time = v_start + v_dur, agent_id = NEW.assigned_agent_id, updated_at = now() WHERE id = r.id;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public._person_bookings(p_profile_id uuid, p_date date)
 RETURNS TABLE(start_time time without time zone, end_time time without time zone, customer_name text, job_id uuid, lead_id uuid, agent_id uuid, schedule_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.start_time,
         COALESCE(s.end_time, (s.start_time + make_interval(mins => public.default_booking_minutes(COALESCE(j.job_type, l.service_type, l.primary_intent::text))))::time),
         COALESCE(l.customer_name, j.title), s.job_id, s.lead_id, s.agent_id, s.id
  FROM public.job_schedules s
  LEFT JOIN public.jobs j ON j.id = s.job_id
  LEFT JOIN public.leads l ON l.id = s.lead_id
  WHERE s.agent_id = p_profile_id AND s.scheduled_date = p_date AND s.start_time IS NOT NULL
    AND lower(coalesce(j.status,'')) NOT IN ('cancelled','canceled','completed')
    AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled','resolved_before_visit')
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
    AND l.deleted_at IS NULL AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled','resolved_before_visit')
    AND NOT EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = l.id)
  UNION ALL
  SELECT (GREATEST(b.starts_at, (p_date::timestamp) AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')::time,
         CASE WHEN b.ends_at >= ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg') THEN time '23:59:59'
              ELSE (b.ends_at AT TIME ZONE 'Africa/Johannesburg')::time END,
         CASE WHEN b.kind = 'leave' THEN 'Off' ELSE 'Blocked' END,
         NULL::uuid, NULL::uuid, b.profile_id, NULL::uuid
  FROM public.staff_blocked_time b
  WHERE b.profile_id = p_profile_id AND b.archived_at IS NULL
    AND b.starts_at < ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND b.ends_at > ((p_date::timestamp) AT TIME ZONE 'Africa/Johannesburg');
$function$
;

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
  IF p_minutes IS NULL OR p_minutes < 30 OR p_minutes > 2880 THEN RAISE EXCEPTION 'Duration must be between 30 minutes and 2 days'; END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public._p3_offer_round(p_job uuid, p_round integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_local timestamp; d date; t time; v_min int; v_fit_min int; v_radius numeric; p record; f record;
  v_n int := 0; v_body text; v_oid uuid; v_by timestamptz := now() + interval '15 minutes';
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL OR j.lead_id IS NULL OR j.scheduled_for IS NULL THEN RETURN 0; END IF;
  v_local := j.scheduled_for AT TIME ZONE 'Africa/Johannesburg'; d := v_local::date; t := v_local::time;
  v_min := GREATEST(COALESCE((extract(epoch FROM j.estimated_duration) / 60)::int, 240), 30);
  v_fit_min := LEAST(v_min, 480);
  v_radius := 50 * GREATEST(p_round, 1);
  v_body := concat_ws(' · ', public._p3_suburb(j.address), to_char(d, 'Dy DD Mon') || ' ' || to_char(t, 'HH24:MI'),
    CASE WHEN v_min >= 960 THEN '2 days' WHEN v_min >= 480 THEN 'Full day' WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h' ELSE round(v_min / 60.0, 1)::text || ' h' END);
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
END $function$
;

CREATE OR REPLACE FUNCTION public.job_watchdog_scan()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_new integer := 0; v_id uuid; v_hhmm text;
  v_rule text; v_sev text; v_msg text; v_tech_msg text;
BEGIN
  UPDATE job_alerts a SET resolved_at = now(), resolution = 'auto: cleared'
  FROM jobs j
  WHERE a.job_id = j.id AND a.resolved_at IS NULL AND (
    j.status IN ('completed','cancelled')
    OR (a.rule IN ('not_accepted','not_accepted_urgent') AND NOT EXISTS (SELECT 1 FROM assignments x WHERE x.job_id = j.id AND x.status = 'proposed'))
    OR (a.rule = 'not_started' AND j.started_at IS NOT NULL)
    OR (a.rule = 'no_en_route' AND (j.started_at IS NOT NULL OR j.status <> 'scheduled'))
    OR (a.rule = 'not_finished' AND j.completed_at IS NOT NULL));

  FOR r IN
    SELECT j.id, j.company_id, j.title, j.scheduled_for, j.status, j.started_at, j.estimated_duration,
           s.profile_id, s.status AS astatus, s.created_at AS assigned_at, coalesce(p.full_name,'Technician') AS tech
    FROM jobs j
    JOIN LATERAL (SELECT * FROM assignments x WHERE x.job_id = j.id ORDER BY x.created_at DESC LIMIT 1) s ON true
    LEFT JOIN profiles p ON p.id = s.profile_id
    WHERE j.status NOT IN ('completed','cancelled') AND j.completed_at IS NULL
      AND j.scheduled_for > now() - interval '2 days' AND j.scheduled_for < now() + interval '2 days'
  LOOP
    v_rule := NULL; v_sev := 'warning'; v_tech_msg := NULL;
    v_hhmm := to_char(r.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI');
    IF r.astatus = 'proposed' AND r.scheduled_for <= now() + interval '60 minutes' THEN
      v_rule := 'not_accepted_urgent'; v_sev := 'critical';
      v_msg := r.tech || ' has not accepted "' || r.title || '" (' || v_hhmm || '). Call or reassign.';
    ELSIF r.astatus = 'proposed' AND (r.assigned_at < now() - interval '2 hours'
          OR now() > (((r.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date - 1) + time '17:00') AT TIME ZONE 'Africa/Johannesburg') THEN
      v_rule := 'not_accepted';
      v_msg := r.tech || ' has not accepted "' || r.title || '" (' || v_hhmm || ').';
      v_tech_msg := 'Please accept or decline "' || r.title || '" on ' || v_hhmm || '.';
    ELSIF r.started_at IS NULL AND now() > r.scheduled_for + interval '30 minutes' THEN
      v_rule := 'not_started'; v_sev := 'critical';
      v_msg := '"' || r.title || '" (' || v_hhmm || ') has not been started by ' || r.tech || '.';
    ELSIF r.status = 'scheduled' AND r.started_at IS NULL AND now() >= r.scheduled_for - interval '15 minutes' THEN
      v_rule := 'no_en_route';
      v_msg := r.tech || ' has not marked "on my way" for "' || r.title || '" (' || v_hhmm || ').';
      v_tech_msg := 'Tap "On my way" for "' || r.title || '" (' || v_hhmm || ').';
    ELSIF r.started_at IS NOT NULL AND now() > r.scheduled_for + coalesce(r.estimated_duration, interval '2 hours') + interval '1 hour' THEN
      v_rule := 'not_finished';
      v_msg := '"' || r.title || '" (' || v_hhmm || ') is running over and not marked done by ' || r.tech || '.';
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
    SELECT p.id, 'job_watchdog', CASE WHEN v_sev='critical' THEN 'Urgent: job needs attention' ELSE 'Job needs attention' END,
           v_msg, r.id, jsonb_build_object('rule', v_rule, 'alert_id', v_id, 'severity', v_sev)
    FROM profiles p WHERE p.company_id = r.company_id
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin','dispatcher'));
    IF v_tech_msg IS NOT NULL AND r.profile_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
      VALUES (r.profile_id, 'job_watchdog', 'Reminder', v_tech_msg, r.id, jsonb_build_object('rule', v_rule));
    END IF;
  END LOOP;
  RETURN v_new;
END $function$
;

DROP TRIGGER IF EXISTS trg_sync_lead_schedule ON public.leads;
CREATE TRIGGER trg_sync_lead_schedule AFTER UPDATE OF scheduled_date, scheduled_time, assigned_agent_id ON public.leads FOR EACH ROW EXECUTE FUNCTION sync_lead_schedule();
DROP FUNCTION IF EXISTS public.booking_end_time(time, interval);
