-- lovable-cron-fallback-reviewed: alerts are about events NOT happening by a deadline; only a timer can detect absence. Limited to working hours.
CREATE TABLE public.job_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  profile_id uuid,
  rule text NOT NULL CHECK (rule IN ('not_accepted','not_accepted_urgent','no_en_route','not_started','not_finished')),
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text,
  UNIQUE (job_id, rule)
);
CREATE INDEX job_alerts_open_idx ON public.job_alerts(company_id) WHERE resolved_at IS NULL;
GRANT SELECT, UPDATE ON public.job_alerts TO authenticated;
GRANT ALL ON public.job_alerts TO service_role;
ALTER TABLE public.job_alerts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._job_alert_office(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id
    WHERE p.id = _uid AND p.company_id = _company AND r.role IN ('admin','dispatcher'))
$$;

CREATE POLICY "Office reads company job alerts" ON public.job_alerts FOR SELECT TO authenticated
  USING (public._job_alert_office(auth.uid(), company_id));
CREATE POLICY "Office resolves company job alerts" ON public.job_alerts FOR UPDATE TO authenticated
  USING (public._job_alert_office(auth.uid(), company_id))
  WITH CHECK (public._job_alert_office(auth.uid(), company_id));

CREATE OR REPLACE FUNCTION public.job_watchdog_scan()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.job_watchdog_scan() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('job-watchdog-scan', '*/5 4-18 * * *', 'SELECT public.job_watchdog_scan()');