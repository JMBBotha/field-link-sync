-- Phase a2 (2026-10-23): late alert on every job, tech "En route", at-risk flag (drive time from addresses only, POPIA),
-- and office-approved "Tell client" drafts (email or SMS, never WhatsApp, never automatic).
-- Rollback: docs/db-releases/2026-10-23_job_en_route_a2_rollback.sql

-- 1) Admin settings (defaults apply when a company has no row)
CREATE TABLE IF NOT EXISTS public.job_watch_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  late_checkin_minutes integer NOT NULL DEFAULT 30 CHECK (late_checkin_minutes BETWEEN 5 AND 240),
  en_route_buffer_minutes integer NOT NULL DEFAULT 15 CHECK (en_route_buffer_minutes BETWEEN 0 AND 120),
  en_route_floor_minutes integer NOT NULL DEFAULT 20 CHECK (en_route_floor_minutes BETWEEN 0 AND 240),
  en_route_fallback_minutes integer NOT NULL DEFAULT 60 CHECK (en_route_fallback_minutes BETWEEN 5 AND 480),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
ALTER TABLE public.job_watch_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY jws_office_read ON public.job_watch_settings FOR SELECT TO authenticated
  USING (public._job_alert_office(auth.uid(), company_id));
CREATE POLICY jws_admin_insert ON public.job_watch_settings FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));
CREATE POLICY jws_admin_update ON public.job_watch_settings FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.job_watch_cfg(p_company_id uuid)
RETURNS public.job_watch_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT s FROM public.job_watch_settings s WHERE s.company_id = p_company_id),
    ROW(p_company_id, 30, 15, 20, 60, now(), NULL)::public.job_watch_settings);
$$;

-- 2) En route timestamp: stamped whenever the job goes to 'dispatched' (job sheet RPC or My Jobs "En route")
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS en_route_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_job_en_route()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'dispatched' AND OLD.status IS DISTINCT FROM 'dispatched' THEN
    NEW.en_route_at := coalesce(NEW.en_route_at, now());
  ELSIF NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled' THEN
    NEW.en_route_at := NULL;  -- sent back to scheduled (e.g. rebooked): the en-route mark no longer counts
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_job_en_route ON public.jobs;
CREATE TRIGGER trg_stamp_job_en_route BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_job_en_route();

-- 3) Drive estimate from addresses only (stored lat/lng of the job, the tech's previous job that day, or home base).
--    Straight line x 1.4 road factor at 45 km/h, minimum 5 min. No device location is used.
CREATE OR REPLACE FUNCTION public.drive_minutes_estimate(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL ELSE
    greatest(5, ceil(
      2 * 6371 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
      * 1.4 / 45.0 * 60)::integer) END;
$$;

-- Leave-by plan for a job. Returns labels only (never the home-base address).
CREATE OR REPLACE FUNCTION public.job_en_route_plan(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_tech uuid; v_prev record; v_home record; c public.job_watch_settings;
  v_drive integer; v_from text := 'none'; v_lead integer;
BEGIN
  SELECT id, company_id, scheduled_for, lat, lng INTO j FROM jobs WHERE id = p_job_id;
  IF NOT FOUND OR j.scheduled_for IS NULL THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND j.company_id IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not your company' USING ERRCODE = '42501';
  END IF;
  c := public.job_watch_cfg(j.company_id);
  SELECT a.profile_id INTO v_tech FROM assignments a
   WHERE a.job_id = p_job_id AND coalesce(a.status, '') <> 'rejected' ORDER BY a.created_at DESC LIMIT 1;
  IF v_tech IS NOT NULL THEN
    SELECT pj.id, pj.lat, pj.lng INTO v_prev FROM jobs pj
     WHERE pj.id <> p_job_id AND pj.status <> 'cancelled'
       AND (pj.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date = (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date
       AND pj.scheduled_for < j.scheduled_for
       AND EXISTS (SELECT 1 FROM assignments pa WHERE pa.job_id = pj.id AND pa.profile_id = v_tech AND coalesce(pa.status, '') <> 'rejected')
     ORDER BY pj.scheduled_for DESC LIMIT 1;
    IF v_prev.id IS NOT NULL THEN
      v_from := 'previous job';
      v_drive := public.drive_minutes_estimate(v_prev.lat::float8, v_prev.lng::float8, j.lat::float8, j.lng::float8);
    ELSE
      SELECT lat, lng INTO v_home FROM staff_home_bases WHERE profile_id = v_tech;
      IF FOUND THEN
        v_from := 'home base';
        v_drive := public.drive_minutes_estimate(v_home.lat, v_home.lng, j.lat::float8, j.lng::float8);
      END IF;
    END IF;
  END IF;
  v_lead := CASE WHEN v_drive IS NULL THEN c.en_route_fallback_minutes
                 ELSE greatest(v_drive + c.en_route_buffer_minutes, c.en_route_floor_minutes) END;
  RETURN jsonb_build_object('drive_minutes', v_drive, 'drive_from', v_from, 'fallback', v_drive IS NULL,
    'buffer_minutes', c.en_route_buffer_minutes, 'floor_minutes', c.en_route_floor_minutes,
    'fallback_minutes', c.en_route_fallback_minutes, 'lead_minutes', v_lead,
    'leave_by', j.scheduled_for - make_interval(mins => v_lead));
END $$;
REVOKE ALL ON FUNCTION public.job_en_route_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_en_route_plan(uuid) TO authenticated;

-- 4) Tech RPC: also accepts 'dispatched' (En route). No client message is sent from here.
CREATE OR REPLACE FUNCTION public.tech_set_job_status(p_job_id uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_mine boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('dispatched','in_progress','completed') THEN RAISE EXCEPTION 'Invalid status %', p_status; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  v_mine := EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job_id AND a.profile_id = auth.uid()
                      AND COALESCE(a.status,'') <> 'rejected');
  IF NOT v_mine AND NOT (public.is_ops_user(auth.uid()) AND j.company_id = public.get_user_company_id(auth.uid())) THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE = '42501'; END IF;
  IF j.status IN ('completed','cancelled') THEN RETURN j.status; END IF;
  -- En route: only from scheduled; the site check is done on site, so it does not block leaving.
  IF p_status = 'dispatched' THEN
    IF j.status <> 'scheduled' THEN RETURN j.status; END IF;
    UPDATE public.assignments SET status = 'accepted'
     WHERE job_id = p_job_id AND profile_id = auth.uid() AND status = 'proposed';
    UPDATE public.jobs SET status = 'dispatched' WHERE id = p_job_id;
    RETURN 'dispatched';
  END IF;
  -- R2 site check gate: phone/online install jobs need costs confirmed and locked first
  IF public.fl_job_needs_site_check(p_job_id) AND coalesce(j.site_check_status,'') <> 'confirmed' THEN
    RAISE EXCEPTION '%', CASE j.site_check_status
      WHEN 'awaiting_client' THEN 'Waiting for the client to approve the updated quote'
      WHEN 'awaiting_pricing' THEN 'Waiting for the office to price the changes'
      WHEN 'declined' THEN 'Client declined – do not proceed'
      ELSE 'Do the site check first' END USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.assignments SET status = p_status,
         started_at = COALESCE(started_at, now()),
         completed_at = CASE WHEN p_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
   WHERE job_id = p_job_id AND profile_id = auth.uid() AND status IS DISTINCT FROM p_status AND COALESCE(status,'') <> 'rejected';
  IF j.status IS DISTINCT FROM p_status THEN
    UPDATE public.jobs SET status = p_status WHERE id = p_job_id;
  END IF;
  RETURN p_status;
END $function$;

-- 5) Watchdog: late alert on EVERY job (assigned or not), at-risk uses the leave-by plan, settings per company.
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

-- 6) Tell client: office-approved drafts. Email goes via the already-deployed send-transactional-email function;
--    SMS is sent by the office from their own phone (sms: link), because the app has no SMS provider. Never WhatsApp.
CREATE TABLE IF NOT EXISTS public.job_client_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES public.job_alerts(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  to_address text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','discarded')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  sent_via text CHECK (sent_via IN ('email_function','office_sms_app')),
  net_request_id bigint
);
CREATE INDEX IF NOT EXISTS job_client_messages_job_idx ON public.job_client_messages (job_id, created_at DESC);
ALTER TABLE public.job_client_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY jcm_office_read ON public.job_client_messages FOR SELECT TO authenticated
  USING (public._job_alert_office(auth.uid(), company_id));
-- writes only through the RPCs below

-- the one place a client email leaves the database; kept separate so it can be swapped out in tests
CREATE OR REPLACE FUNCTION public._job_client_email_post(p_to text, p_subject text, p_html text, p_sender uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_token uuid; v_req bigint;
BEGIN
  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not configured'; END IF;
  SELECT net.http_post(
    url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', p_to, 'subject', p_subject, 'html', p_html, 'signature_mode', 'person', 'sender_user_id', p_sender::text)
  ) INTO v_req;
  RETURN v_req;
END $$;
REVOKE ALL ON FUNCTION public._job_client_email_post(text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.draft_client_job_message(p_job_id uuid, p_channel text, p_alert_id uuid DEFAULT NULL)
RETURNS public.job_client_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.draft_client_job_message(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_client_job_message(uuid, text, uuid) TO authenticated;

-- Approve = the office pressed "Approve & send". Email is posted; SMS is marked sent and the UI opens the office phone's SMS app.
CREATE OR REPLACE FUNCTION public.approve_client_job_message(p_id uuid, p_to text, p_subject text, p_body text)
RETURNS public.job_client_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m public.job_client_messages; v_job record; v_req bigint; v_html text;
BEGIN
  SELECT * INTO m FROM job_client_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF NOT public._job_alert_office(auth.uid(), m.company_id) THEN RAISE EXCEPTION 'Office only' USING ERRCODE = '42501'; END IF;
  IF m.status <> 'draft' THEN RAISE EXCEPTION 'This message was already %', m.status; END IF;
  IF coalesce(btrim(p_body), '') = '' THEN RAISE EXCEPTION 'Message is empty'; END IF;
  IF coalesce(btrim(p_to), '') = '' THEN RAISE EXCEPTION 'No % for this client', CASE WHEN m.channel = 'email' THEN 'email address' ELSE 'phone number' END; END IF;
  IF m.channel = 'email' THEN
    IF btrim(p_to) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'That email address does not look right'; END IF;
    v_html := '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827">'
      || replace(replace(replace(replace(btrim(p_body), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>') || '</div>';
    v_req := public._job_client_email_post(btrim(p_to), coalesce(nullif(btrim(p_subject), ''), 'Update on your appointment'), v_html, auth.uid());
  END IF;
  UPDATE job_client_messages SET to_address = btrim(p_to), subject = nullif(btrim(p_subject), ''), body = btrim(p_body),
         status = 'sent', approved_by = auth.uid(), approved_at = now(),
         sent_via = CASE WHEN m.channel = 'email' THEN 'email_function' ELSE 'office_sms_app' END, net_request_id = v_req
   WHERE id = p_id RETURNING * INTO m;
  SELECT lead_id, customer_id INTO v_job FROM jobs WHERE id = m.job_id;
  IF v_job.lead_id IS NOT NULL OR v_job.customer_id IS NOT NULL THEN
    INSERT INTO communication_log (lead_id, customer_id, type, subject, body, agent_id)
    VALUES (v_job.lead_id, v_job.customer_id, CASE WHEN m.channel = 'email' THEN 'email' ELSE 'note' END,
            coalesce(m.subject, 'SMS to ' || m.to_address || ' (sent from office phone)'), m.body, auth.uid());
  END IF;
  RETURN m;
END $$;
REVOKE ALL ON FUNCTION public.approve_client_job_message(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_client_job_message(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.discard_client_job_message(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m public.job_client_messages;
BEGIN
  SELECT * INTO m FROM job_client_messages WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public._job_alert_office(auth.uid(), m.company_id) THEN RAISE EXCEPTION 'Office only' USING ERRCODE = '42501'; END IF;
  UPDATE job_client_messages SET status = 'discarded' WHERE id = p_id AND status = 'draft';
END $$;
REVOKE ALL ON FUNCTION public.discard_client_job_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_client_job_message(uuid) TO authenticated;
