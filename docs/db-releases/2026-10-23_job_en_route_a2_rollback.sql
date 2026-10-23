-- Rollback for 20261023200000_job_en_route_a2.sql. Restores job_watchdog_scan and tech_set_job_status exactly as live
-- before a2 (md5 of pg_get_functiondef: bab2e48fcab422e0c91351a9a7226f1f / def4c800e29bfbd9609122356282c11a).
-- Drops the a2 tables (job_watch_settings, job_client_messages: settings and sent-message history are lost) and jobs.en_route_at.
DROP FUNCTION IF EXISTS public.discard_client_job_message(uuid);
DROP FUNCTION IF EXISTS public.approve_client_job_message(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.draft_client_job_message(uuid, text, uuid);
DROP FUNCTION IF EXISTS public._job_client_email_post(text, text, text, uuid);
DROP TABLE IF EXISTS public.job_client_messages;
DROP TRIGGER IF EXISTS trg_stamp_job_en_route ON public.jobs;
DROP FUNCTION IF EXISTS public.stamp_job_en_route();
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
    ELSIF r.started_at IS NOT NULL AND now() > r.scheduled_for + coalesce(r.estimated_duration, interval '3 hours') + interval '1 hour' THEN
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
CREATE OR REPLACE FUNCTION public.tech_set_job_status(p_job_id uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_mine boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'Invalid status %', p_status; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  v_mine := EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job_id AND a.profile_id = auth.uid()
                      AND COALESCE(a.status,'') <> 'rejected');
  IF NOT v_mine AND NOT (public.is_ops_user(auth.uid()) AND j.company_id = public.get_user_company_id(auth.uid())) THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE = '42501'; END IF;
  IF j.status IN ('completed','cancelled') THEN RETURN j.status; END IF;
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
END $function$
;
DROP FUNCTION IF EXISTS public.job_en_route_plan(uuid);
DROP FUNCTION IF EXISTS public.drive_minutes_estimate(double precision, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.job_watch_cfg(uuid);
DROP TABLE IF EXISTS public.job_watch_settings;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS en_route_at;
