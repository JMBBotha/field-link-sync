-- Phase (b): multi-day jobs with a daily check-in. Additive only; rollback in docs/db-releases/2026-10-24_job_multiday_b_rollback.sql
-- Single-day jobs are unchanged: day_index/day_count/scheduled_until stay NULL for them.

-- 1) Schema --------------------------------------------------------------------------------------
ALTER TABLE public.job_schedules ADD COLUMN IF NOT EXISTS day_index smallint;
ALTER TABLE public.job_schedules ADD COLUMN IF NOT EXISTS day_count smallint;
ALTER TABLE public.job_schedules ADD CONSTRAINT job_schedules_day_chk
  CHECK ((day_index IS NULL AND day_count IS NULL) OR (day_index >= 1 AND day_count >= day_index AND day_count <= 30));
CREATE INDEX IF NOT EXISTS job_schedules_job_day_idx ON public.job_schedules (job_id, day_index);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS scheduled_until timestamptz;  -- end of the last day (multi-day only)

-- Day log: one row per job/tech/day. is_billable=false keeps it off the invoice (useInvoiceAutofill filters it).
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES public.job_schedules(id) ON DELETE SET NULL;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS en_route_at timestamptz;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS hours_worked numeric(5,2);  -- the day's hours as recorded by Done for today (hours_onsite is generated from the times)
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS hours_auto numeric(6,2);
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS hours_edit_note text;
CREATE UNIQUE INDEX IF NOT EXISTS job_time_entries_job_day_key ON public.job_time_entries (job_id, agent_id, work_date) WHERE job_id IS NOT NULL;

-- Johan 23 Oct 19:01: after photos AND a sign-off for every day's work. The tech signs off himself (name + time, optional
-- drawn signature); a client signature is optional. Recorded per day on the day log and on the completion.
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS signed_off_at timestamptz;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS signed_off_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS signed_off_name text;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS tech_signature_data_url text;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS client_signature_data_url text;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS after_photo_count integer;
ALTER TABLE public.job_completions ADD COLUMN IF NOT EXISTS tech_signoff_name text;
ALTER TABLE public.job_completions ADD COLUMN IF NOT EXISTS tech_signoff_at timestamptz;
ALTER TABLE public.job_completions ADD COLUMN IF NOT EXISTS tech_signature_data_url text;
ALTER TABLE public.job_completions ADD COLUMN IF NOT EXISTS after_photo_count integer;
-- When the photo + sign-off rule started: completions finished earlier (old offline queues) are not blocked.
CREATE TABLE IF NOT EXISTS public.job_rule_rollouts (rule text PRIMARY KEY, effective_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.job_rule_rollouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_rule_rollouts FROM anon, authenticated;
INSERT INTO public.job_rule_rollouts (rule) VALUES ('after_photos_signoff') ON CONFLICT (rule) DO NOTHING;

-- Per-day watchdog alerts: work_date NULL = job-level alert (as before)
ALTER TABLE public.job_alerts ADD COLUMN IF NOT EXISTS work_date date;
ALTER TABLE public.job_alerts DROP CONSTRAINT job_alerts_job_id_rule_key;
ALTER TABLE public.job_alerts ADD CONSTRAINT job_alerts_job_rule_day_key UNIQUE NULLS NOT DISTINCT (job_id, rule, work_date);

-- Holidays: company_id NULL = SA public holiday (incl. the Sunday -> Monday rule); company rows = closure days.
CREATE TABLE IF NOT EXISTS public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL DEFAULT 'public' CHECK (kind IN ('public', 'closure')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_holidays_kind_chk CHECK ((company_id IS NULL) = (kind = 'public')),
  CONSTRAINT public_holidays_day_key UNIQUE NULLS NOT DISTINCT (company_id, holiday_date)
);
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_holidays_read ON public.public_holidays FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY public_holidays_ops_insert ON public.public_holidays FOR INSERT TO authenticated
  WITH CHECK (company_id IS NOT NULL AND kind = 'closure' AND public.is_ops_user(auth.uid()) AND company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY public_holidays_ops_update ON public.public_holidays FOR UPDATE TO authenticated
  USING (company_id IS NOT NULL AND public.is_ops_user(auth.uid()) AND company_id = public.get_user_company_id(auth.uid()))
  WITH CHECK (company_id IS NOT NULL AND kind = 'closure' AND public.is_ops_user(auth.uid()) AND company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY public_holidays_ops_delete ON public.public_holidays FOR DELETE TO authenticated
  USING (company_id IS NOT NULL AND public.is_ops_user(auth.uid()) AND company_id = public.get_user_company_id(auth.uid()));
REVOKE ALL ON public.public_holidays FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_holidays TO authenticated;

INSERT INTO public.public_holidays (company_id, holiday_date, name, kind, created_by) VALUES
 (NULL,'2026-01-01','New Year''s Day','public',NULL),
 (NULL,'2026-03-21','Human Rights Day','public',NULL),
 (NULL,'2026-04-03','Good Friday','public',NULL),
 (NULL,'2026-04-06','Family Day','public',NULL),
 (NULL,'2026-04-27','Freedom Day','public',NULL),
 (NULL,'2026-05-01','Workers'' Day','public',NULL),
 (NULL,'2026-06-16','Youth Day','public',NULL),
 (NULL,'2026-08-09','National Women''s Day','public',NULL),
 (NULL,'2026-08-10','National Women''s Day (observed)','public',NULL),
 (NULL,'2026-09-24','Heritage Day','public',NULL),
 (NULL,'2026-12-16','Day of Reconciliation','public',NULL),
 (NULL,'2026-12-25','Christmas Day','public',NULL),
 (NULL,'2026-12-26','Day of Goodwill','public',NULL),
 (NULL,'2027-01-01','New Year''s Day','public',NULL),
 (NULL,'2027-03-21','Human Rights Day','public',NULL),
 (NULL,'2027-03-22','Human Rights Day (observed)','public',NULL),
 (NULL,'2027-03-26','Good Friday','public',NULL),
 (NULL,'2027-03-29','Family Day','public',NULL),
 (NULL,'2027-04-27','Freedom Day','public',NULL),
 (NULL,'2027-05-01','Workers'' Day','public',NULL),
 (NULL,'2027-06-16','Youth Day','public',NULL),
 (NULL,'2027-08-09','National Women''s Day','public',NULL),
 (NULL,'2027-09-24','Heritage Day','public',NULL),
 (NULL,'2027-12-16','Day of Reconciliation','public',NULL),
 (NULL,'2027-12-25','Christmas Day','public',NULL),
 (NULL,'2027-12-26','Day of Goodwill','public',NULL),
 (NULL,'2027-12-27','Day of Goodwill (observed)','public',NULL)
ON CONFLICT ON CONSTRAINT public_holidays_day_key DO NOTHING;

-- 2) Working-day helpers (internal; not callable by app users) -----------------------------------
CREATE OR REPLACE FUNCTION public._holiday_on(p_company uuid, p_date date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT h.name || CASE WHEN h.kind = 'closure' THEN ' (company closed)' ELSE '' END
    FROM public.public_holidays h
   WHERE h.holiday_date = p_date AND (h.company_id IS NULL OR h.company_id = p_company)
   ORDER BY h.company_id NULLS LAST LIMIT 1;
$$;

-- Same rules as staff_work_window (person hours > company hours > Mon-Fri 08-17, full-day leave) plus holidays,
-- without the caller check so offer rounds and triggers can use it. p_profile NULL = company hours.
CREATE OR REPLACE FUNCTION public._job_work_day(p_profile uuid, p_company uuid, p_date date)
RETURNS TABLE(is_working boolean, start_time time, end_time time, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
DECLARE v_dow int := extract(dow FROM p_date)::int; v_h text; r_work boolean; r_start time; r_end time;
  c_days int[]; c_start time; c_end time; v_found boolean := false;
BEGIN
  IF p_profile IS NOT NULL THEN
    SELECT h.is_working, COALESCE(h.start_time, '08:00'), COALESCE(h.end_time, '17:00') INTO r_work, r_start, r_end
      FROM public.staff_work_hours h WHERE h.profile_id = p_profile AND h.day_of_week = v_dow;
    v_found := FOUND;
  END IF;
  IF NOT v_found THEN
    SELECT c.work_days, c.work_start, c.work_end INTO c_days, c_start, c_end FROM public.companies c WHERE c.id = p_company;
    IF c_days IS NOT NULL THEN r_work := v_dow = ANY(c_days); r_start := COALESCE(c_start, '08:00'); r_end := COALESCE(c_end, '17:00');
    ELSE r_work := v_dow BETWEEN 1 AND 5; r_start := '08:00'; r_end := '17:00'; END IF;
  END IF;
  v_h := public._holiday_on(p_company, p_date);
  IF v_h IS NOT NULL THEN RETURN QUERY SELECT false, r_start, r_end, v_h; RETURN; END IF;
  IF NOT r_work THEN
    RETURN QUERY SELECT false, r_start, r_end, CASE WHEN v_dow IN (0, 6) THEN 'Weekend' ELSE 'Not a working day' END; RETURN;
  END IF;
  IF p_profile IS NOT NULL AND EXISTS (SELECT 1 FROM public.staff_blocked_time b
       WHERE b.profile_id = p_profile AND b.kind = 'leave' AND b.archived_at IS NULL
         AND b.starts_at <= ((p_date + r_start) AT TIME ZONE 'Africa/Johannesburg')
         AND b.ends_at >= ((p_date + r_end) AT TIME ZONE 'Africa/Johannesburg')) THEN
    RETURN QUERY SELECT false, r_start, r_end, 'On leave'; RETURN;
  END IF;
  RETURN QUERY SELECT true, r_start, r_end, NULL::text;
END $$;

-- Plan a run: days already worked (checked in) stay where they are; the rest are walked forward from p_start
-- over working days (skipping weekends, holidays, closure days, leave). Whole days in the tech's hours.
-- p_days = total days (incl. worked); or p_end = last day (inclusive). Clashes listed per new day when asked.
CREATE OR REPLACE FUNCTION public._job_days_plan(p_company uuid, p_job uuid, p_tech uuid, p_start date,
  p_days integer, p_end date, p_with_clashes boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_days jsonb := '[]'; v_skip jsonb := '[]'; v_worked int := 0; v_last date; d date; w record; v_n int := 0;
  v_target int; v_clash jsonb; v_cd int := 0; v_total int := 0; v_guard int := 0; r record; v_admin boolean;
BEGIN
  v_admin := auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin');
  IF p_job IS NOT NULL THEN
    FOR r IN SELECT s.id, s.scheduled_date, s.start_time, s.end_time FROM public.job_schedules s
              WHERE s.job_id = p_job AND EXISTS (SELECT 1 FROM public.job_time_entries e
                    WHERE e.job_id = p_job AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL)
              ORDER BY s.scheduled_date LOOP
      v_n := v_n + 1; v_worked := v_worked + 1; v_last := r.scheduled_date;
      v_total := v_total + (extract(epoch FROM (r.end_time - r.start_time)) / 60)::int;
      v_days := v_days || jsonb_build_object('day_index', v_n, 'date', r.scheduled_date, 'start', to_char(r.start_time, 'HH24:MI'),
        'end', to_char(r.end_time, 'HH24:MI'), 'minutes', (extract(epoch FROM (r.end_time - r.start_time)) / 60)::int,
        'worked', true, 'schedule_id', r.id, 'clashes', '[]'::jsonb);
    END LOOP;
  END IF;
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 30) THEN RAISE EXCEPTION 'Pick between 1 and 30 days'; END IF;
  IF p_days IS NULL AND p_end IS NULL THEN RAISE EXCEPTION 'Give a number of days or an end date'; END IF;
  IF p_end IS NOT NULL AND p_end < p_start THEN RAISE EXCEPTION 'The end date is before the start date'; END IF;
  IF v_last IS NOT NULL AND p_start <= v_last THEN
    RAISE EXCEPTION 'Day % was already worked on % — the remaining days must start after it', v_worked, to_char(v_last, 'DD Mon');
  END IF;
  v_target := COALESCE(p_days, 30);
  d := p_start;
  WHILE v_n < v_target LOOP
    EXIT WHEN p_end IS NOT NULL AND d > p_end;
    v_guard := v_guard + 1;
    IF v_guard > 120 THEN RAISE EXCEPTION 'Could not find enough working days in the next 4 months'; END IF;
    SELECT * INTO w FROM public._job_work_day(p_tech, p_company, d);
    IF NOT w.is_working THEN
      v_skip := v_skip || jsonb_build_object('date', d, 'reason', w.reason);
    ELSE
      v_n := v_n + 1;
      v_clash := '[]';
      IF p_with_clashes AND p_tech IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'),
                 'label', CASE WHEN v_admin OR b.agent_id = auth.uid() THEN COALESCE(b.customer_name, 'Booking') ELSE 'Busy' END,
                 'job_id', b.job_id, 'lead_id', b.lead_id) ORDER BY b.start_time), '[]')
          INTO v_clash
          FROM public._person_bookings(p_tech, d) b
         WHERE b.job_id IS DISTINCT FROM p_job AND b.start_time < w.end_time AND b.end_time > w.start_time;
        IF jsonb_array_length(v_clash) > 0 THEN v_cd := v_cd + 1; END IF;
      END IF;
      v_total := v_total + (extract(epoch FROM (w.end_time - w.start_time)) / 60)::int;
      v_days := v_days || jsonb_build_object('day_index', v_n, 'date', d, 'start', to_char(w.start_time, 'HH24:MI'),
        'end', to_char(w.end_time, 'HH24:MI'), 'minutes', (extract(epoch FROM (w.end_time - w.start_time)) / 60)::int,
        'worked', false, 'clashes', v_clash);
    END IF;
    d := d + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'No working days in that range'; END IF;
  IF p_days IS NOT NULL AND v_n < p_days THEN RAISE EXCEPTION 'Only % working day(s) fit before %', v_n, to_char(p_end, 'DD Mon'); END IF;
  RETURN jsonb_build_object('days', v_days, 'day_count', v_n, 'skipped', v_skip, 'clash_days', v_cd,
    'total_minutes', v_total, 'first', v_days->0->>'date', 'last', v_days->(v_n - 1)->>'date');
END $$;

-- Write a plan to job_schedules + jobs atomically. Reuses existing rows (keeps ids, notes, route data).
CREATE OR REPLACE FUNCTION public._job_days_apply(p_job uuid, p_tech uuid, p_plan jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_n int := jsonb_array_length(p_plan->'days'); v_ids uuid[]; v_keep uuid[] := '{}'; i int; v_free int := 1;
  x jsonb; v_id uuid; v_notes text; v_prev text := current_setting('app.job_days_writing', true);
  v_first jsonb; v_lastd jsonb;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  PERFORM set_config('app.job_days_writing', '1', true);
  SELECT array_agg(s.id ORDER BY s.scheduled_date, s.day_index NULLS FIRST, s.created_at),
         (array_agg(s.notes ORDER BY s.day_index NULLS FIRST, s.created_at))[1]
    INTO v_ids, v_notes
    FROM public.job_schedules s WHERE s.job_id = p_job
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_plan->'days') e WHERE (e->>'worked')::boolean AND (e->>'schedule_id')::uuid = s.id);
  v_ids := COALESCE(v_ids, '{}');
  FOR i IN 0 .. v_n - 1 LOOP
    x := p_plan->'days'->i;
    IF (x->>'worked')::boolean THEN
      UPDATE public.job_schedules SET day_index = CASE WHEN v_n > 1 THEN i + 1 END, day_count = CASE WHEN v_n > 1 THEN v_n END,
             agent_id = COALESCE(p_tech, agent_id), updated_at = now()
       WHERE id = (x->>'schedule_id')::uuid;
      CONTINUE;
    END IF;
    IF v_free <= COALESCE(array_length(v_ids, 1), 0) THEN
      v_id := v_ids[v_free]; v_free := v_free + 1;
      UPDATE public.job_schedules SET scheduled_date = (x->>'date')::date, start_time = (x->>'start')::time, end_time = (x->>'end')::time,
             agent_id = p_tech, day_index = CASE WHEN v_n > 1 THEN i + 1 END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = v_id;
    ELSE
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count)
      VALUES (j.lead_id, p_job, p_tech, (x->>'date')::date, (x->>'start')::time, (x->>'end')::time,
              COALESCE(v_notes, j.title), CASE WHEN v_n > 1 THEN i + 1 END, CASE WHEN v_n > 1 THEN v_n END);
    END IF;
  END LOOP;
  IF v_free <= COALESCE(array_length(v_ids, 1), 0) THEN
    DELETE FROM public.job_schedules WHERE id = ANY (v_ids[v_free:]);
  END IF;
  v_first := p_plan->'days'->0; v_lastd := p_plan->'days'->(v_n - 1);
  UPDATE public.jobs SET
    scheduled_for = ((v_first->>'date')::date + (v_first->>'start')::time) AT TIME ZONE 'Africa/Johannesburg',
    scheduled_until = CASE WHEN v_n > 1 THEN ((v_lastd->>'date')::date + (v_lastd->>'end')::time) AT TIME ZONE 'Africa/Johannesburg' END,
    estimated_duration = make_interval(mins => (p_plan->>'total_minutes')::int), updated_at = now()
   WHERE id = p_job;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
END $$;

REVOKE ALL ON FUNCTION public._holiday_on(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._job_work_day(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._job_days_plan(uuid, uuid, uuid, date, integer, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._job_days_apply(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3) Office RPCs ----------------------------------------------------------------------------------
-- Preview a run (no writes). p_tech NULL = company hours, no clash check (offer mode).
CREATE OR REPLACE FUNCTION public.preview_job_days(p_tech_id uuid, p_start_date date, p_days integer DEFAULT NULL,
  p_end_date date DEFAULT NULL, p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR v_co IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND company_id = v_co) THEN
    RAISE EXCEPTION 'Not your company' USING ERRCODE = '42501'; END IF;
  IF p_tech_id IS NOT NULL AND NOT (public.rh_ops_ok(v_co) OR p_tech_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the office can check a technician''s days' USING ERRCODE = '42501'; END IF;
  IF p_tech_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_tech_id AND company_id = v_co) THEN
    RAISE EXCEPTION 'Not your company' USING ERRCODE = '42501'; END IF;
  RETURN public._job_days_plan(v_co, p_job_id, p_tech_id, p_start_date, p_days, p_end_date, p_tech_id IS NOT NULL);
END $$;

-- Book (or move) a whole run. A clash blocks it; only an admin can "Book anyway" (with a reason, logged).
CREATE OR REPLACE FUNCTION public.schedule_job_days(p_job_id uuid, p_tech_id uuid, p_start_date date, p_days integer DEFAULT NULL,
  p_end_date date DEFAULT NULL, p_dry_run boolean DEFAULT false, p_force boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_plan jsonb; v_tname text; v_cust text; v_body text;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF auth.uid() IS NULL OR NOT public.rh_ops_ok(j.company_id) THEN
    RAISE EXCEPTION 'Only the office can book multi-day jobs' USING ERRCODE = '42501'; END IF;
  IF j.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This job is closed'; END IF;
  IF j.lead_id IS NULL THEN RAISE EXCEPTION 'Multi-day jobs need a client lead on the job'; END IF;
  IF p_start_date IS NULL THEN RAISE EXCEPTION 'Pick a start date'; END IF;
  IF p_tech_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_tech_id AND company_id = j.company_id) THEN
    RAISE EXCEPTION 'Pick someone in your company'; END IF;
  v_plan := public._job_days_plan(j.company_id, j.id, p_tech_id, p_start_date, p_days, p_end_date, true);
  IF p_dry_run THEN RETURN v_plan || jsonb_build_object('ok', true, 'dry_run', true); END IF;
  IF (v_plan->>'clash_days')::int > 0 THEN
    IF NOT p_force THEN
      RETURN v_plan || jsonb_build_object('ok', false, 'message',
        'Clashes on ' || (v_plan->>'clash_days') || ' day' || CASE WHEN (v_plan->>'clash_days')::int = 1 THEN '' ELSE 's' END);
    END IF;
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only an admin can book over a clash' USING ERRCODE = '42501'; END IF;
    IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why you are booking over the clash'; END IF;
    INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
    VALUES ('job', j.id, 'clash_override', 'multi-day clash on ' || (v_plan->>'clash_days') || ' day(s)', left(btrim(p_reason), 500), auth.uid(), j.company_id);
  END IF;
  PERFORM public._job_days_apply(j.id, p_tech_id, v_plan);
  IF p_tech_id IS NOT NULL THEN
    UPDATE public.assignments SET profile_id = p_tech_id
     WHERE job_id = j.id AND COALESCE(status, '') <> 'rejected' AND profile_id IS DISTINCT FROM p_tech_id;
    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.assignments WHERE job_id = j.id AND COALESCE(status, '') <> 'rejected') THEN
      INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
      VALUES (j.id, p_tech_id, 'accepted', 'internal', auth.uid());
    END IF;
  END IF;
  -- one notification for the run instead of one per day row
  SELECT full_name INTO v_tname FROM public.profiles WHERE id = p_tech_id;
  SELECT COALESCE(l.customer_name, 'Customer') INTO v_cust FROM public.leads l WHERE l.id = j.lead_id;
  v_body := v_cust || ' - ' || (v_plan->>'day_count') || ' day' || CASE WHEN (v_plan->>'day_count')::int = 1 THEN '' ELSE 's' END
    || ', ' || to_char((v_plan->>'first')::date, 'DD Mon') || ' to ' || to_char((v_plan->>'last')::date, 'DD Mon YYYY')
    || COALESCE(' with ' || v_tname, '');
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  SELECT DISTINCT u, 'job_schedule', 'Job Scheduled', v_body, j.lead_id FROM (
    SELECT ur.user_id AS u FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role IN ('admin', 'dispatcher') AND p.company_id = j.company_id
    UNION SELECT p_tech_id) x WHERE u IS NOT NULL;
  RETURN v_plan || jsonb_build_object('ok', true, 'dry_run', false, 'job_id', j.id);
END $$;

-- Day list for one job. The assigned tech sees only their own day entries; office sees all in their company.
CREATE OR REPLACE FUNCTION public.job_days(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_ops boolean; v_mine boolean; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  v_ops := public.is_ops_user(auth.uid()) AND j.company_id = public.get_user_company_id(auth.uid());
  v_mine := EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = j.id AND a.profile_id = auth.uid() AND COALESCE(a.status, '') <> 'rejected');
  IF NOT v_ops AND NOT v_mine THEN RAISE EXCEPTION 'Not your job' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schedule_id', s.id, 'day_index', COALESCE(s.day_index, 1), 'day_count', COALESCE(s.day_count, 1),
      'date', s.scheduled_date, 'start', to_char(s.start_time, 'HH24:MI'), 'end', to_char(s.end_time, 'HH24:MI'),
      'agent_id', s.agent_id,
      'en_route_at', e.en_route_at, 'checked_in_at', e.checked_in_at, 'checked_out_at', e.checked_out_at,
      'hours', e.hours_worked, 'hours_auto', e.hours_auto, 'hours_edit_note', e.hours_edit_note, 'notes', e.notes,
      'signed_off_at', e.signed_off_at, 'signed_off_name', e.signed_off_name, 'after_photos', e.after_photo_count,
      'state', CASE WHEN e.checked_out_at IS NOT NULL THEN 'done' WHEN e.checked_in_at IS NOT NULL THEN 'on_site'
                    WHEN e.en_route_at IS NOT NULL THEN 'en_route'
                    WHEN j.status IN ('completed', 'cancelled') THEN 'not_needed'
                    WHEN s.scheduled_date < v_today THEN 'missed' WHEN s.scheduled_date = v_today THEN 'today' ELSE 'upcoming' END)
      ORDER BY s.scheduled_date, s.day_index), '[]'::jsonb)
    INTO v
    FROM public.job_schedules s
    LEFT JOIN LATERAL (SELECT * FROM public.job_time_entries x WHERE x.job_id = s.job_id AND x.work_date = s.scheduled_date
                         AND (v_ops OR x.agent_id = auth.uid()) ORDER BY x.created_at LIMIT 1) e ON true
   WHERE s.job_id = j.id;
  RETURN jsonb_build_object('job_id', j.id, 'status', j.status, 'today', v_today,
    'multi_day', COALESCE((SELECT max(day_count) FROM public.job_schedules WHERE job_id = j.id), 1) > 1,
    'day_count', COALESCE((SELECT max(day_count) FROM public.job_schedules WHERE job_id = j.id), 1),
    'scheduled_until', j.scheduled_until, 'days', v, 'lead_id', j.lead_id,
    'labour_hours', (SELECT round(COALESCE(sum(hours_worked), 0), 2) FROM public.job_time_entries x
                      WHERE x.job_id = j.id AND (v_ops OR x.agent_id = auth.uid())));
END $$;

-- Day states for the dispatch board (office only, own company).
CREATE OR REPLACE FUNCTION public.job_day_states(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_ops_user(auth.uid()) OR v_co IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF p_to - p_from > 62 THEN RAISE EXCEPTION 'Range too long'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('schedule_id', s.id, 'job_id', s.job_id, 'date', s.scheduled_date,
      'state', CASE WHEN e.checked_out_at IS NOT NULL THEN 'done' WHEN e.checked_in_at IS NOT NULL THEN 'on_site'
                    WHEN e.en_route_at IS NOT NULL THEN 'en_route' ELSE 'none' END,
      'hours', e.hours_worked)), '[]'::jsonb)
    FROM public.job_schedules s JOIN public.jobs j ON j.id = s.job_id
    JOIN public.job_time_entries e ON e.job_id = s.job_id AND e.work_date = s.scheduled_date
   WHERE j.company_id = v_co AND s.scheduled_date BETWEEN p_from AND p_to);
END $$;

-- 4) Tech day flow --------------------------------------------------------------------------------
-- Shared guard: assigned tech, or office user in the job's company. Returns the tech the day belongs to.
CREATE OR REPLACE FUNCTION public._job_day_actor(p_job_id uuid, OUT job_company uuid, OUT tech uuid, OUT is_ops boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  job_company := j.company_id;
  is_ops := public.is_ops_user(auth.uid()) AND j.company_id = public.get_user_company_id(auth.uid());
  IF EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job_id AND a.profile_id = auth.uid() AND COALESCE(a.status, '') <> 'rejected') THEN
    tech := auth.uid();
  ELSIF is_ops THEN
    SELECT a.profile_id INTO tech FROM public.assignments a WHERE a.job_id = p_job_id AND COALESCE(a.status, '') <> 'rejected'
     ORDER BY a.created_at DESC LIMIT 1;
    IF tech IS NULL THEN RAISE EXCEPTION 'No technician on this job yet'; END IF;
  ELSE
    RAISE EXCEPTION 'Not your job' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._job_day_time(p_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
BEGIN
  -- offline taps carry their own time; never in the future, never older than 36 h
  IF p_at IS NULL OR p_at > now() THEN RETURN now(); END IF;
  IF p_at < now() - interval '36 hours' THEN RAISE EXCEPTION 'That tap is too old to record — ask the office to fix the day'; END IF;
  RETURN p_at;
END $$;

-- En route for today's day. Day 1 / single-day = the a2 job-level En route.
CREATE OR REPLACE FUNCTION public.tech_day_en_route(p_job_id uuid, p_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; j record; s record; v_at timestamptz := public._job_day_time(p_at); v_d date; v_multi boolean;
BEGIN
  SELECT * INTO a FROM public._job_day_actor(p_job_id);
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.status IN ('completed', 'cancelled') THEN RETURN jsonb_build_object('ok', false, 'message', 'This job is closed'); END IF;
  v_d := (v_at AT TIME ZONE 'Africa/Johannesburg')::date;
  v_multi := COALESCE((SELECT max(day_count) FROM public.job_schedules WHERE job_id = p_job_id), 1) > 1;
  IF j.status = 'scheduled' THEN
    UPDATE public.assignments SET status = 'accepted' WHERE job_id = p_job_id AND profile_id = a.tech AND status = 'proposed';
    UPDATE public.jobs SET status = 'dispatched', en_route_at = COALESCE(en_route_at, v_at) WHERE id = p_job_id;
  END IF;
  IF NOT v_multi THEN RETURN jsonb_build_object('ok', true, 'multi_day', false, 'status', 'dispatched'); END IF;
  SELECT * INTO s FROM public.job_schedules WHERE job_id = p_job_id AND scheduled_date = v_d LIMIT 1;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Today isn''t one of this job''s days — ask the office to move it'; END IF;
  INSERT INTO public.job_time_entries (lead_id, agent_id, work_date, start_time, end_time, is_billable, job_id, schedule_id, en_route_at)
  VALUES (j.lead_id, a.tech, v_d, (v_at AT TIME ZONE 'Africa/Johannesburg')::time, (v_at AT TIME ZONE 'Africa/Johannesburg')::time,
          false, p_job_id, s.id, v_at)
  ON CONFLICT (job_id, agent_id, work_date) WHERE job_id IS NOT NULL
  DO UPDATE SET en_route_at = COALESCE(job_time_entries.en_route_at, EXCLUDED.en_route_at);
  RETURN jsonb_build_object('ok', true, 'multi_day', true, 'day_index', s.day_index, 'day_count', s.day_count, 'en_route_at', v_at);
END $$;

-- Check in for today. Day 1 also starts the job (site-check gate applies).
CREATE OR REPLACE FUNCTION public.tech_check_in(p_job_id uuid, p_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; j record; s record; e record; v_at timestamptz := public._job_day_time(p_at); v_d date; v_multi boolean;
BEGIN
  SELECT * INTO a FROM public._job_day_actor(p_job_id);
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.status IN ('completed', 'cancelled') THEN RETURN jsonb_build_object('ok', false, 'message', 'This job is closed'); END IF;
  v_multi := COALESCE((SELECT max(day_count) FROM public.job_schedules WHERE job_id = p_job_id), 1) > 1;
  IF public.fl_job_needs_site_check(p_job_id) AND COALESCE(j.site_check_status, '') <> 'confirmed' THEN
    RAISE EXCEPTION '%', CASE j.site_check_status
      WHEN 'awaiting_client' THEN 'Waiting for the client to approve the updated quote'
      WHEN 'awaiting_pricing' THEN 'Waiting for the office to price the changes'
      WHEN 'declined' THEN 'Client declined – do not proceed'
      ELSE 'Do the site check first' END USING ERRCODE = 'P0001';
  END IF;
  v_d := (v_at AT TIME ZONE 'Africa/Johannesburg')::date;
  IF v_multi THEN
    SELECT * INTO s FROM public.job_schedules WHERE job_id = p_job_id AND scheduled_date = v_d LIMIT 1;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Today isn''t one of this job''s days — ask the office to move it'; END IF;
    SELECT * INTO e FROM public.job_time_entries WHERE job_id = p_job_id AND agent_id = a.tech AND work_date = v_d;
    IF e.checked_out_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'message', 'Today is already marked Day done',
        'day_index', s.day_index, 'day_count', s.day_count);
    END IF;
  END IF;
  IF j.status <> 'in_progress' THEN
    UPDATE public.assignments SET status = 'in_progress', started_at = COALESCE(started_at, v_at)
     WHERE job_id = p_job_id AND profile_id = a.tech AND COALESCE(status, '') NOT IN ('rejected', 'in_progress');
    UPDATE public.jobs SET status = 'in_progress', started_at = COALESCE(started_at, v_at) WHERE id = p_job_id;
  END IF;
  IF NOT v_multi THEN RETURN jsonb_build_object('ok', true, 'multi_day', false, 'status', 'in_progress'); END IF;
  INSERT INTO public.job_time_entries (lead_id, agent_id, work_date, start_time, end_time, is_billable, job_id, schedule_id, checked_in_at)
  VALUES (j.lead_id, a.tech, v_d, (v_at AT TIME ZONE 'Africa/Johannesburg')::time, (v_at AT TIME ZONE 'Africa/Johannesburg')::time,
          false, p_job_id, s.id, v_at)
  ON CONFLICT (job_id, agent_id, work_date) WHERE job_id IS NOT NULL
  DO UPDATE SET checked_in_at = COALESCE(job_time_entries.checked_in_at, EXCLUDED.checked_in_at),
                start_time = CASE WHEN job_time_entries.checked_in_at IS NULL THEN EXCLUDED.start_time ELSE job_time_entries.start_time END,
                end_time = CASE WHEN job_time_entries.checked_in_at IS NULL THEN EXCLUDED.end_time ELSE job_time_entries.end_time END,
                schedule_id = EXCLUDED.schedule_id;
  RETURN jsonb_build_object('ok', true, 'multi_day', true, 'day_index', s.day_index, 'day_count', s.day_count, 'checked_in_at', v_at);
END $$;

-- After photos on the job's lead taken since a time (synced photos land in job_photos; offline ones sync before the day tap
-- because the queue replays in tap order).
CREATE OR REPLACE FUNCTION public._job_after_photos(p_lead_id uuid, p_since timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM public.job_photos
   WHERE lead_id = p_lead_id AND photo_type = 'after' AND created_at >= COALESCE(p_since, '-infinity'::timestamptz);
$$;
REVOKE ALL ON FUNCTION public._job_after_photos(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Done for today: hours default to check-in -> tap; a changed figure needs a reason. Job stays in progress.
-- Johan 23 Oct 19:01: closing a day needs >= 1 after photo taken since that day's check-in AND the tech's sign-off
-- (his name; the time is recorded; a drawn signature is optional). A client signature is optional.
CREATE OR REPLACE FUNCTION public.tech_done_for_today(p_job_id uuid, p_hours numeric DEFAULT NULL, p_notes text DEFAULT NULL,
  p_edit_note text DEFAULT NULL, p_at timestamptz DEFAULT NULL, p_signoff_name text DEFAULT NULL, p_tech_signature text DEFAULT NULL,
  p_client_name text DEFAULT NULL, p_client_signature text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; j record; e record; s record; nx record; v_at timestamptz := public._job_day_time(p_at); v_d date; v_auto numeric; v_h numeric;
        v_photos int;
BEGIN
  SELECT * INTO a FROM public._job_day_actor(p_job_id);
  SELECT id, lead_id INTO j FROM public.jobs WHERE id = p_job_id;
  v_d := (v_at AT TIME ZONE 'Africa/Johannesburg')::date;
  SELECT * INTO e FROM public.job_time_entries WHERE job_id = p_job_id AND agent_id = a.tech AND work_date = v_d FOR UPDATE;
  IF e.id IS NULL OR e.checked_in_at IS NULL THEN RAISE EXCEPTION 'Check in first'; END IF;
  SELECT * INTO s FROM public.job_schedules WHERE job_id = p_job_id AND scheduled_date = v_d LIMIT 1;
  SELECT scheduled_date, day_index INTO nx FROM public.job_schedules WHERE job_id = p_job_id AND scheduled_date > v_d ORDER BY scheduled_date LIMIT 1;
  IF e.checked_out_at IS NULL THEN
    v_auto := GREATEST(round((extract(epoch FROM (v_at - e.checked_in_at)) / 3600.0)::numeric, 2), 0);
    v_h := COALESCE(round(p_hours, 2), v_auto);
    IF v_h < 0 OR v_h > 16 THEN RAISE EXCEPTION 'Hours must be between 0 and 16'; END IF;
    IF abs(v_h - v_auto) >= 0.25 AND length(btrim(COALESCE(p_edit_note, ''))) < 3 THEN
      RAISE EXCEPTION 'Say why the hours differ from the check-in time (% h)', v_auto; END IF;
    v_photos := CASE WHEN j.lead_id IS NULL THEN NULL ELSE public._job_after_photos(j.lead_id, e.checked_in_at) END;
    IF j.lead_id IS NOT NULL AND v_photos < 1 THEN
      RAISE EXCEPTION 'Take at least one after photo of today''s work first' USING ERRCODE = 'P0001'; END IF;
    IF length(btrim(COALESCE(p_signoff_name, ''))) < 2 THEN
      RAISE EXCEPTION 'Sign off today''s work: confirm with your name' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.job_time_entries SET checked_out_at = v_at, end_time = (v_at AT TIME ZONE 'Africa/Johannesburg')::time,
           hours_worked = v_h, hours_auto = v_auto,
           hours_edit_note = CASE WHEN abs(v_h - v_auto) >= 0.25 THEN left(btrim(p_edit_note), 500) END,
           notes = NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), ''), is_billable = false,
           signed_off_at = v_at, signed_off_by = a.tech, signed_off_name = left(btrim(p_signoff_name), 120),
           tech_signature_data_url = NULLIF(p_tech_signature, ''),
           client_name = NULLIF(left(btrim(COALESCE(p_client_name, '')), 120), ''),
           client_signature_data_url = NULLIF(p_client_signature, ''),
           after_photo_count = v_photos
     WHERE id = e.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'day_index', s.day_index, 'day_count', s.day_count, 'hours', COALESCE(v_h, e.hours_worked),
    'after_photos', COALESCE(v_photos, e.after_photo_count), 'signed_off_name', COALESCE(left(btrim(p_signoff_name), 120), e.signed_off_name),
    'is_last', nx.scheduled_date IS NULL, 'next_date', nx.scheduled_date, 'next_day_index', nx.day_index);
END $$;

-- Add a day after the run. Tech: only when the next free working day has no clash, otherwise the office is asked.
-- Office: clash needs an admin "Book anyway" with a reason.
CREATE OR REPLACE FUNCTION public.job_add_day(p_job_id uuid, p_force boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; j record; v_last date; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v_plan jsonb; x jsonb;
  v_n int; v_prev text := current_setting('app.job_days_writing', true); v_end timestamptz; v_tname text; v_msg text; v_by_tech boolean;
BEGIN
  SELECT * INTO a FROM public._job_day_actor(p_job_id);
  v_by_tech := a.tech = auth.uid();
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This job is closed'; END IF;
  IF j.lead_id IS NULL THEN RAISE EXCEPTION 'Multi-day jobs need a client lead on the job'; END IF;
  SELECT max(scheduled_date), count(*) INTO v_last, v_n FROM public.job_schedules WHERE job_id = p_job_id;
  IF v_n = 0 THEN RAISE EXCEPTION 'This job has no booked day yet'; END IF;
  IF v_n >= 30 THEN RAISE EXCEPTION 'A job can run for at most 30 days'; END IF;
  -- one new working day for this tech after the run (and not before today); no clash list for other days
  v_plan := public._job_days_plan(j.company_id, NULL, a.tech, GREATEST(v_last + 1, v_today), 1, NULL, true);
  x := v_plan->'days'->0;
  -- the job's own rows never count as a clash (the plan ran without the job id)
  x := jsonb_set(x, '{clashes}', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(x->'clashes') c
         WHERE (c->>'job_id') IS DISTINCT FROM p_job_id::text), '[]'));
  SELECT full_name INTO v_tname FROM public.profiles WHERE id = a.tech;
  IF jsonb_array_length(x->'clashes') > 0 THEN
    IF v_by_tech AND NOT a.is_ops THEN
      v_msg := COALESCE(v_tname, 'The technician') || ' needs another day on "' || j.title || '". The next free working day, '
        || to_char((x->>'date')::date, 'Dy DD Mon') || ', clashes with another booking — please decide.';
      INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
      SELECT p.id, 'job_day_request', 'Extra day requested', v_msg, j.id, jsonb_build_object('job_id', j.id, 'date', x->>'date', 'link', '/admin/jobs/' || j.id)
        FROM public.profiles p WHERE p.company_id = j.company_id
         AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin', 'dispatcher'));
      RETURN jsonb_build_object('ok', false, 'needs_office', true, 'date', x->>'date',
        'message', 'The next free day (' || to_char((x->>'date')::date, 'Dy DD Mon') || ') clashes with another booking — the office has been asked to decide');
    END IF;
    IF NOT p_force THEN
      RETURN jsonb_build_object('ok', false, 'clash', true, 'date', x->>'date', 'clashes', x->'clashes', 'message', 'That day clashes');
    END IF;
    IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only an admin can book over a clash' USING ERRCODE = '42501'; END IF;
    IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why you are booking over the clash'; END IF;
    INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
    VALUES ('job', j.id, 'clash_override', 'extra day ' || (x->>'date'), left(btrim(p_reason), 500), auth.uid(), j.company_id);
  END IF;
  PERFORM set_config('app.job_days_writing', '1', true);
  WITH o AS (SELECT id, row_number() OVER (ORDER BY scheduled_date, day_index NULLS FIRST, created_at) AS n FROM public.job_schedules WHERE job_id = j.id)
  UPDATE public.job_schedules s SET day_index = o.n, day_count = v_n + 1, updated_at = now() FROM o WHERE o.id = s.id;
  INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count)
  SELECT j.lead_id, j.id, a.tech, (x->>'date')::date, (x->>'start')::time, (x->>'end')::time,
         (SELECT notes FROM public.job_schedules WHERE job_id = j.id ORDER BY day_index LIMIT 1), v_n + 1, v_n + 1;
  v_end := ((x->>'date')::date + (x->>'end')::time) AT TIME ZONE 'Africa/Johannesburg';
  UPDATE public.jobs SET scheduled_until = v_end,
         estimated_duration = COALESCE(estimated_duration, interval '0') + make_interval(mins => (x->>'minutes')::int), updated_at = now()
   WHERE id = j.id;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
  v_msg := 'Day ' || (v_n + 1) || ' added to "' || j.title || '": ' || to_char((x->>'date')::date, 'Dy DD Mon')
    || COALESCE(' (' || v_tname || ')', '');
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT u, 'job_schedule', 'Day added', v_msg, j.lead_id, jsonb_build_object('job_id', j.id) FROM (
    SELECT p.id AS u FROM public.profiles p WHERE v_by_tech AND p.company_id = j.company_id
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin', 'dispatcher'))
    UNION SELECT a.tech WHERE NOT v_by_tech) q WHERE u IS NOT NULL;
  RETURN jsonb_build_object('ok', true, 'date', x->>'date', 'day_index', v_n + 1, 'day_count', v_n + 1);
END $$;

REVOKE ALL ON FUNCTION public._job_day_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._job_day_time(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_job_days(uuid, date, integer, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_job_days(uuid, uuid, date, integer, date, boolean, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_days(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_day_states(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_day_en_route(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_check_in(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_done_for_today(uuid, numeric, text, text, timestamptz, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_add_day(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_job_days(uuid, date, integer, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_job_days(uuid, uuid, date, integer, date, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_days(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_day_states(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_day_en_route(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_check_in(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_done_for_today(uuid, numeric, text, text, timestamptz, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_add_day(uuid, boolean, text) TO authenticated;

-- 5) Keep runs consistent -------------------------------------------------------------------------
-- jobs.scheduled_for edits: single-day jobs behave exactly as before. For a run, a new date re-walks the
-- remaining days from that date (same tech, same count; worked days stay); a time-only change shifts each
-- remaining day's start. Writes made by the day functions themselves are skipped (app.job_days_writing).
CREATE OR REPLACE FUNCTION public.sync_job_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_local timestamp; v_dur interval; v_n int; v_tech uuid; v_plan jsonb; v_old date; v_prev text;
BEGIN
  IF NEW.scheduled_for IS NULL THEN RETURN NEW; END IF;
  IF current_setting('app.job_days_writing', true) = '1' THEN RETURN NEW; END IF;
  v_local := NEW.scheduled_for AT TIME ZONE 'Africa/Johannesburg';
  SELECT max(day_count), (array_agg(agent_id ORDER BY day_index))[1] INTO v_n, v_tech FROM public.job_schedules WHERE job_id = NEW.id;
  IF COALESCE(v_n, 1) > 1 THEN
    IF NEW.scheduled_for IS NOT DISTINCT FROM OLD.scheduled_for THEN RETURN NEW; END IF;  -- duration edits don't touch a run
    v_old := (OLD.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date;
    IF v_local::date <> v_old THEN
      v_plan := public._job_days_plan(NEW.company_id, NEW.id, v_tech,
        GREATEST(v_local::date, COALESCE((SELECT max(e.work_date) + 1 FROM public.job_time_entries e WHERE e.job_id = NEW.id AND e.checked_in_at IS NOT NULL), v_local::date)),
        v_n, NULL, false);
      PERFORM public._job_days_apply(NEW.id, v_tech, v_plan);
    ELSE
      v_prev := current_setting('app.job_days_writing', true);
      PERFORM set_config('app.job_days_writing', '1', true);
      UPDATE public.job_schedules s
         SET start_time = v_local::time,
             end_time = public.booking_end_time(v_local::time, s.end_time - s.start_time), updated_at = now()
       WHERE s.job_id = NEW.id
         AND NOT EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = NEW.id AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL);
      UPDATE public.jobs SET scheduled_until = (SELECT (s.scheduled_date + s.end_time) AT TIME ZONE 'Africa/Johannesburg'
             FROM public.job_schedules s WHERE s.job_id = NEW.id ORDER BY s.scheduled_date DESC LIMIT 1)
       WHERE id = NEW.id;
      PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
    END IF;
    RETURN NEW;
  END IF;
  v_dur := COALESCE(NEW.estimated_duration, interval '3 hours');
  UPDATE public.job_schedules
     SET scheduled_date = v_local::date, start_time = v_local::time, end_time = public.booking_end_time(v_local::time, v_dur), updated_at = now()
   WHERE job_id = NEW.id
     AND (scheduled_date IS DISTINCT FROM v_local::date OR start_time IS DISTINCT FROM v_local::time
          OR end_time IS DISTINCT FROM public.booking_end_time(v_local::time, v_dur));
  RETURN NEW;
END $function$;

-- Per-row "Job Scheduled/Rescheduled" notices are suppressed while a whole run is written (one summary is sent instead).
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
  IF current_setting('app.job_days_writing', true) = '1' THEN RETURN NEW; END IF;
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
            || CASE WHEN NEW.day_count > 1 THEN ' (day ' || NEW.day_index || ' of ' || NEW.day_count || ')' ELSE '' END
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

-- Finishing early frees the remaining days; any open day is closed at the completion time.
CREATE OR REPLACE FUNCTION public.job_days_on_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_today date; v_prev text; v_at timestamptz;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = NEW.id AND day_count > 1) THEN RETURN NEW; END IF;
  v_at := COALESCE(NEW.completed_at, now());
  v_today := (v_at AT TIME ZONE 'Africa/Johannesburg')::date;
  v_prev := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  UPDATE public.job_time_entries SET checked_out_at = v_at, end_time = (v_at AT TIME ZONE 'Africa/Johannesburg')::time,
         hours_auto = GREATEST(round((extract(epoch FROM (v_at - checked_in_at)) / 3600.0)::numeric, 2), 0),
         hours_worked = GREATEST(round((extract(epoch FROM (v_at - checked_in_at)) / 3600.0)::numeric, 2), 0)
   WHERE job_id = NEW.id AND checked_in_at IS NOT NULL AND checked_out_at IS NULL;
  DELETE FROM public.job_schedules s WHERE s.job_id = NEW.id AND s.scheduled_date > v_today
     AND NOT EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = NEW.id AND e.work_date = s.scheduled_date);
  WITH o AS (SELECT id, row_number() OVER (ORDER BY scheduled_date) AS n, count(*) OVER () AS c FROM public.job_schedules WHERE job_id = NEW.id)
  UPDATE public.job_schedules s SET day_index = CASE WHEN o.c > 1 THEN o.n END, day_count = CASE WHEN o.c > 1 THEN o.c END
    FROM o WHERE o.id = s.id AND (s.day_index IS DISTINCT FROM CASE WHEN o.c > 1 THEN o.n END OR s.day_count IS DISTINCT FROM CASE WHEN o.c > 1 THEN o.c END);
  UPDATE public.jobs SET scheduled_until = (SELECT CASE WHEN count(*) OVER () > 1 THEN (s.scheduled_date + s.end_time) AT TIME ZONE 'Africa/Johannesburg' END
          FROM public.job_schedules s WHERE s.job_id = NEW.id ORDER BY s.scheduled_date DESC LIMIT 1)
   WHERE id = NEW.id;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_job_days_on_complete AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.job_days_on_complete();

-- Labour on the completion record = the sum of the day entries (open day counted up to now).
CREATE OR REPLACE FUNCTION public.job_completion_day_labour()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_job uuid; v_h numeric;
BEGIN
  v_job := NEW.job_id;
  IF v_job IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT j.id INTO v_job FROM public.jobs j WHERE j.lead_id = NEW.lead_id AND j.status <> 'cancelled'
       AND EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = j.id) ORDER BY j.created_at DESC LIMIT 1;
  END IF;
  IF v_job IS NULL OR NOT EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = v_job AND e.checked_in_at IS NOT NULL) THEN
    RETURN NEW; END IF;
  SELECT sum(COALESCE(e.hours_worked, CASE WHEN e.checked_out_at IS NULL
           THEN GREATEST(extract(epoch FROM (COALESCE(NEW.completed_at, now()) - e.checked_in_at)) / 3600.0, 0) END, 0))
    INTO v_h FROM public.job_time_entries e WHERE e.job_id = v_job AND e.checked_in_at IS NOT NULL;
  NEW.labour_minutes := round(COALESCE(v_h, 0) * 60)::int;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_job_completions_00_day_labour BEFORE INSERT OR UPDATE ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.job_completion_day_labour();


-- Johan 23 Oct 19:01: finishing a job (single-day, or the last day of a run) needs >= 1 after photo and the tech's sign-off.
-- Enforced on the server for every completion recorded from the rollout on; a client signature stays optional.
-- Multi-day: the after photos must be from the open (last) day, i.e. taken since that day's check-in.
CREATE OR REPLACE FUNCTION public.job_completion_photos_signoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from timestamptz; v_job uuid; v_since timestamptz; v_n int;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN RETURN NEW; END IF;
  SELECT effective_at INTO v_from FROM public.job_rule_rollouts WHERE rule = 'after_photos_signoff';
  IF v_from IS NULL OR COALESCE(NEW.completed_at, now()) < v_from THEN RETURN NEW; END IF;
  v_job := NEW.job_id;
  IF v_job IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT j.id INTO v_job FROM public.jobs j WHERE j.lead_id = NEW.lead_id AND j.status <> 'cancelled' ORDER BY j.created_at DESC LIMIT 1;
  END IF;
  IF v_job IS NOT NULL THEN
    SELECT max(e.checked_in_at) INTO v_since FROM public.job_time_entries e
     WHERE e.job_id = v_job AND e.checked_in_at IS NOT NULL AND e.checked_out_at IS NULL;
  END IF;
  v_n := public._job_after_photos(NEW.lead_id, v_since);
  IF COALESCE(v_n, 0) < 1 THEN
    RAISE EXCEPTION '%', CASE WHEN v_since IS NULL THEN 'Take at least one after photo before finishing the job'
                              ELSE 'Take at least one after photo of today''s work before finishing the job' END USING ERRCODE = 'P0001';
  END IF;
  IF length(btrim(COALESCE(NEW.tech_signoff_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Sign off the work: confirm with your name' USING ERRCODE = 'P0001';
  END IF;
  NEW.tech_signoff_name := left(btrim(NEW.tech_signoff_name), 120);
  NEW.tech_signoff_at := COALESCE(NEW.tech_signoff_at, NEW.completed_at, now());
  NEW.after_photo_count := v_n;
  -- The run's open (last) day carries the same sign-off.
  IF v_since IS NOT NULL THEN
    UPDATE public.job_time_entries SET signed_off_at = NEW.tech_signoff_at, signed_off_by = NEW.technician_id,
           signed_off_name = NEW.tech_signoff_name, tech_signature_data_url = NEW.tech_signature_data_url,
           client_name = NEW.customer_name, client_signature_data_url = NEW.signature_data_url, after_photo_count = v_n
     WHERE job_id = v_job AND checked_in_at IS NOT NULL AND checked_out_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_job_completions_01_photos_signoff BEFORE INSERT OR UPDATE ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.job_completion_photos_signoff();
REVOKE ALL ON FUNCTION public.job_completion_photos_signoff() FROM PUBLIC, anon, authenticated;

-- The tech merge path (techs cannot upsert) must carry the new sign-off fields too. Pre-image in the rollback.
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
    labour_minutes = NEW.labour_minutes, photo_count = NEW.photo_count, status = NEW.status, completed_at = NEW.completed_at,
    tech_signoff_name = NEW.tech_signoff_name, tech_signoff_at = NEW.tech_signoff_at, tech_signature_data_url = NEW.tech_signature_data_url
  WHERE lead_id = NEW.lead_id AND technician_id = u;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.job_completions WHERE lead_id = NEW.lead_id) THEN
      RAISE EXCEPTION 'Completion already recorded by another technician' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.job_completions SELECT NEW.*;
  END IF;
  RETURN NULL;
END $function$;

-- 6) Hand-over from an accepted quote: optional p_days (> 1 = multi-day run of whole working days).
DROP FUNCTION public.hand_to_technician(uuid, date, time without time zone, integer, text, uuid);
CREATE FUNCTION public.hand_to_technician(p_quote_id uuid, p_date date, p_start time without time zone, p_minutes integer, p_mode text, p_tech_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT NULL::integer, p_force boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; q record; v_inv uuid; j record; v_job uuid; v_addr text; v_lat double precision; v_lng double precision;
  v_for timestamptz; v_end time; v_n int; v_tname text; v_multi boolean := COALESCE(p_days, 1) > 1; v_plan jsonb;
BEGIN
  IF p_mode NOT IN ('pick', 'offer') THEN RAISE EXCEPTION 'Choose Pick technician or Offer to technicians'; END IF;
  IF p_date IS NULL OR p_start IS NULL THEN RAISE EXCEPTION 'Date and start time are required'; END IF;
  IF NOT v_multi AND (p_minutes IS NULL OR p_minutes < 30) THEN RAISE EXCEPTION 'Duration must be at least 30 minutes'; END IF;
  IF NOT v_multi AND extract(epoch FROM p_start)::int / 60 + p_minutes > 23 * 60 + 59 THEN
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
  IF v_multi AND q.lead_id IS NULL THEN RAISE EXCEPTION 'Multi-day jobs need a client lead on the quote'; END IF;

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

  IF v_multi THEN
    -- whole working days from p_date; for Pick, every day must be free (admin can Book anyway with a reason)
    v_plan := public._job_days_plan(q.company_id, j.id, CASE WHEN p_mode = 'pick' THEN p_tech_id END, p_date, p_days, NULL, p_mode = 'pick');
    IF (v_plan->>'clash_days')::int > 0 THEN
      IF NOT p_force THEN
        RETURN v_plan || jsonb_build_object('ok', false, 'clash', true, 'message',
          'Clashes on ' || (v_plan->>'clash_days') || ' of the ' || (v_plan->>'day_count') || ' days');
      END IF;
      IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'Only an admin can book over a clash' USING ERRCODE = '42501'; END IF;
      IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why you are booking over the clash'; END IF;
      INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
      VALUES ('quote', q.id, 'clash_override', 'multi-day clash on ' || (v_plan->>'clash_days') || ' day(s)', left(btrim(p_reason), 500), v_uid, q.company_id);
    END IF;
    p_minutes := (v_plan->>'total_minutes')::int;
    p_start := (v_plan->'days'->0->>'start')::time;
    p_date := (v_plan->'days'->0->>'date')::date;
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
  IF v_multi THEN PERFORM set_config('app.job_days_writing', '1', true); END IF;

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

  IF v_multi THEN
    IF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = v_job) THEN
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
      VALUES (q.lead_id, v_job, NULL, p_date, p_start, (v_plan->'days'->0->>'end')::time, btrim('Installation — quote ' || COALESCE(q.quote_number, '')));
    END IF;
    PERFORM public._job_days_apply(v_job, CASE WHEN p_mode = 'pick' THEN p_tech_id END, v_plan);
    PERFORM set_config('app.job_days_writing', '', true);
  ELSIF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = v_job) AND q.lead_id IS NOT NULL THEN
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (q.lead_id, v_job, NULL, p_date, p_start, v_end, btrim('Installation — quote ' || COALESCE(q.quote_number, '')));
  ELSE
    UPDATE public.job_schedules SET scheduled_date = p_date, start_time = p_start, end_time = v_end, updated_at = now() WHERE job_id = v_job;
  END IF;

  IF p_mode = 'pick' THEN
    INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
    VALUES (v_job, p_tech_id, 'accepted', 'internal', v_uid);
    SELECT full_name INTO v_tname FROM public.profiles WHERE id = p_tech_id;
    RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'pick', 'days', COALESCE(v_plan->'day_count', '1'::jsonb),
      'message', 'Handed to ' || COALESCE(v_tname, 'technician')
        || CASE WHEN v_multi THEN ' for ' || (v_plan->>'day_count') || ' days (' || to_char((v_plan->>'first')::date, 'DD Mon') || '–' || to_char((v_plan->>'last')::date, 'DD Mon') || ')' ELSE '' END);
  END IF;

  v_n := public._p3_offer_round(v_job, 1);
  IF v_n = 0 THEN
    PERFORM public._p3_notify_unclaimed(v_job);
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'offer', 'offered', v_n, 'days', COALESCE(v_plan->'day_count', '1'::jsonb),
    'message', CASE WHEN v_n = 0 THEN 'No technician is free then — the office has been asked to pick one'
                    ELSE 'Offered to ' || v_n || ' technician' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' — first to accept gets it' END);
END $function$
;
REVOKE ALL ON FUNCTION public.hand_to_technician(uuid, date, time without time zone, integer, text, uuid, integer, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hand_to_technician(uuid, date, time without time zone, integer, text, uuid, integer, boolean, text) TO authenticated, service_role;

-- 7) Install offers: multi-day runs go only to techs free on every day; re-checked on claim.
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
END $function$
;

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
    'days', COALESCE((SELECT max(s.day_count) FROM public.job_schedules s WHERE s.job_id = j.id), 1),
    'until', (j.scheduled_until AT TIME ZONE 'Africa/Johannesburg')::date,
    'distance_km', o.distance_km, 'respond_by', o.respond_by) ORDER BY o.respond_by), '[]'::jsonb)
  FROM public.offers o JOIN public.jobs j ON j.id = o.job_id LEFT JOIN public.leads l ON l.id = o.lead_id
  WHERE o.staff_id = auth.uid() AND o.offer_type = 'install' AND o.status = 'pending' AND o.respond_by > now();
$function$
;

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
END $function$
;

-- Leave-by for one day of a run (day 2+ start from the tech's home base; no addresses returned).
CREATE OR REPLACE FUNCTION public.job_day_en_route_plan(p_job_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; s record; v_tech uuid; v_home record; c public.job_watch_settings; v_drive integer; v_from text := 'none'; v_lead integer; v_start timestamptz;
BEGIN
  SELECT id, company_id, lat, lng INTO j FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND j.company_id IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not your company' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM job_schedules WHERE job_id = p_job_id AND scheduled_date = p_date LIMIT 1;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  v_start := (s.scheduled_date + s.start_time) AT TIME ZONE 'Africa/Johannesburg';
  c := public.job_watch_cfg(j.company_id);
  SELECT a.profile_id INTO v_tech FROM assignments a
   WHERE a.job_id = p_job_id AND coalesce(a.status, '') <> 'rejected' ORDER BY a.created_at DESC LIMIT 1;
  IF v_tech IS NOT NULL THEN
    SELECT lat, lng INTO v_home FROM staff_home_bases WHERE profile_id = v_tech;
    IF FOUND THEN
      v_from := 'home base';
      v_drive := public.drive_minutes_estimate(v_home.lat, v_home.lng, j.lat::float8, j.lng::float8);
    END IF;
  END IF;
  v_lead := CASE WHEN v_drive IS NULL THEN c.en_route_fallback_minutes
                 ELSE greatest(v_drive + c.en_route_buffer_minutes, c.en_route_floor_minutes) END;
  RETURN jsonb_build_object('drive_minutes', v_drive, 'drive_from', v_from, 'fallback', v_drive IS NULL,
    'buffer_minutes', c.en_route_buffer_minutes, 'floor_minutes', c.en_route_floor_minutes,
    'fallback_minutes', c.en_route_fallback_minutes, 'lead_minutes', v_lead,
    'day_start', v_start, 'leave_by', v_start - make_interval(mins => v_lead));
END $$;
REVOKE ALL ON FUNCTION public.job_day_en_route_plan(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_day_en_route_plan(uuid, date) TO authenticated;

-- 8) Watchdog: whole run in the window, not_finished on the last day only, per-day late / at-risk for day 2+.
CREATE OR REPLACE FUNCTION public.job_watchdog_scan()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_new integer := 0; v_id uuid; v_hhmm text; c public.job_watch_settings; v_plan jsonb; v_leave timestamptz;
  v_rule text; v_sev text; v_msg text; v_tech_msg text; v_meta jsonb; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_start timestamptz; v_day text;
BEGIN
  UPDATE job_alerts a SET resolved_at = now(), resolution = 'auto: cleared'
  FROM jobs j
  WHERE a.job_id = j.id AND a.resolved_at IS NULL AND (
    j.status IN ('completed','cancelled')
    OR (a.rule IN ('not_accepted','not_accepted_urgent') AND NOT EXISTS (SELECT 1 FROM assignments x WHERE x.job_id = j.id AND x.status = 'proposed'))
    OR (a.work_date IS NULL AND a.rule = 'not_started' AND j.started_at IS NOT NULL)
    OR (a.work_date IS NULL AND a.rule = 'no_en_route' AND (j.started_at IS NOT NULL OR j.status <> 'scheduled' OR j.en_route_at IS NOT NULL))
    -- per-day alerts (day 2+ of a run) clear when that day is checked in / en route, or the day is gone
    OR (a.work_date IS NOT NULL AND a.rule = 'not_started' AND EXISTS (SELECT 1 FROM job_time_entries e
          WHERE e.job_id = j.id AND e.work_date = a.work_date AND e.checked_in_at IS NOT NULL))
    OR (a.work_date IS NOT NULL AND a.rule = 'no_en_route' AND EXISTS (SELECT 1 FROM job_time_entries e
          WHERE e.job_id = j.id AND e.work_date = a.work_date AND (e.en_route_at IS NOT NULL OR e.checked_in_at IS NOT NULL)))
    OR (a.work_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM job_schedules s WHERE s.job_id = j.id AND s.scheduled_date = a.work_date))
    OR (a.rule = 'not_finished' AND j.completed_at IS NOT NULL));
  -- once a job is late, the late alert replaces its at-risk alert (one card per job)
  UPDATE job_alerts a SET resolved_at = now(), resolution = 'auto: now late'
  WHERE a.rule = 'no_en_route' AND a.resolved_at IS NULL
    AND EXISTS (SELECT 1 FROM job_alerts b WHERE b.job_id = a.job_id AND b.rule = 'not_started' AND b.resolved_at IS NULL
                AND b.work_date IS NOT DISTINCT FROM a.work_date);

  FOR r IN
    SELECT j.id, j.company_id, j.title, j.scheduled_for, j.scheduled_until, j.status, j.started_at, j.estimated_duration, j.en_route_at,
           s.profile_id, s.status AS astatus, s.created_at AS assigned_at,
           CASE WHEN s.profile_id IS NULL THEN NULL ELSE coalesce(p.full_name,'Technician') END AS tech
    FROM jobs j
    LEFT JOIN LATERAL (SELECT * FROM assignments x WHERE x.job_id = j.id AND coalesce(x.status,'') <> 'rejected'
                       ORDER BY x.created_at DESC LIMIT 1) s ON true
    LEFT JOIN profiles p ON p.id = s.profile_id
    WHERE j.status NOT IN ('completed','cancelled') AND j.completed_at IS NULL AND j.scheduled_for IS NOT NULL
      AND coalesce(j.scheduled_until, j.scheduled_for) > now() - interval '2 days' AND j.scheduled_for < now() + interval '2 days'
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
    -- multi-day: only once the LAST day's end is 1 h past
    ELSIF r.started_at IS NOT NULL AND now() > coalesce(r.scheduled_until, r.scheduled_for + coalesce(r.estimated_duration, interval '3 hours')) + interval '1 hour' THEN
      v_rule := 'not_finished';
      v_msg := '"' || r.title || '" (' || v_hhmm || ') is running over and not marked done by ' || coalesce(r.tech, 'the technician') || '.';
      v_tech_msg := 'Please mark "' || r.title || '" as done when finished.';
    END IF;
    CONTINUE WHEN v_rule IS NULL;
    v_id := NULL;
    INSERT INTO job_alerts (company_id, job_id, profile_id, rule, severity, message)
    VALUES (r.company_id, r.id, r.profile_id, v_rule, v_sev, v_msg)
    ON CONFLICT (job_id, rule, work_date) DO NOTHING RETURNING id INTO v_id;
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

  -- Day 2+ of a multi-day run: late (no check-in by day start + late minutes) and at risk (not en route by leave-by), per day.
  FOR r IN
    SELECT j.id, j.company_id, j.title, s.scheduled_date AS d, s.start_time, s.day_index, s.day_count,
           a.profile_id, coalesce(p.full_name, 'Technician') AS tech, e.en_route_at AS e_route, e.checked_in_at AS e_in
    FROM job_schedules s JOIN jobs j ON j.id = s.job_id
    LEFT JOIN LATERAL (SELECT * FROM assignments x WHERE x.job_id = j.id AND coalesce(x.status,'') <> 'rejected'
                       ORDER BY x.created_at DESC LIMIT 1) a ON true
    LEFT JOIN profiles p ON p.id = a.profile_id
    LEFT JOIN LATERAL (SELECT * FROM job_time_entries x WHERE x.job_id = j.id AND x.work_date = s.scheduled_date
                       ORDER BY x.checked_in_at NULLS LAST LIMIT 1) e ON true
    WHERE s.day_index >= 2 AND s.scheduled_date = v_today
      AND j.status NOT IN ('completed','cancelled') AND j.completed_at IS NULL
  LOOP
    v_rule := NULL; v_sev := 'warning'; v_tech_msg := NULL; v_meta := '{}'::jsonb;
    c := public.job_watch_cfg(r.company_id);
    v_start := (r.d + r.start_time) AT TIME ZONE 'Africa/Johannesburg';
    v_day := 'Day ' || r.day_index || ' of ' || r.day_count;
    v_hhmm := to_char(r.d + r.start_time, 'DD Mon HH24:MI');
    IF r.e_in IS NULL AND now() > v_start + make_interval(mins => c.late_checkin_minutes) THEN
      v_rule := 'not_started'; v_sev := 'critical';
      v_msg := 'Late: ' || v_day || ' of "' || r.title || '" (' || v_hhmm || ') – '
        || CASE WHEN r.profile_id IS NULL THEN 'no technician assigned' ELSE r.tech || ' has not checked in' END
        || ' ' || c.late_checkin_minutes || ' min after the day''s start.';
      v_meta := jsonb_build_object('late_minutes', c.late_checkin_minutes, 'day_index', r.day_index, 'day_count', r.day_count);
    ELSIF r.e_in IS NULL AND r.e_route IS NULL AND r.profile_id IS NOT NULL THEN
      v_plan := public.job_day_en_route_plan(r.id, r.d);
      v_leave := (v_plan->>'leave_by')::timestamptz;
      IF v_leave IS NOT NULL AND now() >= v_leave THEN
        v_rule := 'no_en_route';
        v_msg := 'At risk: ' || r.tech || ' is not en route for ' || v_day || ' of "' || r.title || '" (' || v_hhmm || '). Should have left by '
          || to_char(v_leave AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || ' ('
          || CASE WHEN (v_plan->>'fallback')::boolean THEN 'no drive estimate, ' || (v_plan->>'lead_minutes') || '-min default'
                  ELSE 'drive ~' || (v_plan->>'drive_minutes') || ' min from ' || (v_plan->>'drive_from') END || ').';
        v_tech_msg := 'Tap "En route" when you leave for ' || v_day || ' of "' || r.title || '" (' || v_hhmm || '). Leave by '
          || to_char(v_leave AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || '.';
        v_meta := v_plan || jsonb_build_object('day_index', r.day_index, 'day_count', r.day_count);
      END IF;
    END IF;
    CONTINUE WHEN v_rule IS NULL;
    v_id := NULL;
    INSERT INTO job_alerts (company_id, job_id, profile_id, rule, severity, message, work_date)
    VALUES (r.company_id, r.id, r.profile_id, v_rule, v_sev, v_msg, r.d)
    ON CONFLICT (job_id, rule, work_date) DO NOTHING RETURNING id INTO v_id;
    CONTINUE WHEN v_id IS NULL;
    v_new := v_new + 1;
    INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
    SELECT p.id, 'job_watchdog',
           CASE WHEN v_rule = 'not_started' THEN 'Late: tech not checked in' ELSE 'At risk: tech not en route' END,
           v_msg, r.id, jsonb_build_object('rule', v_rule, 'alert_id', v_id, 'severity', v_sev, 'work_date', r.d) || v_meta
    FROM profiles p WHERE p.company_id = r.company_id
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p.id AND ur.role IN ('admin','dispatcher'));
    IF v_tech_msg IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
      VALUES (r.profile_id, 'job_watchdog', 'Reminder', v_tech_msg, r.id, jsonb_build_object('rule', v_rule, 'work_date', r.d));
    END IF;
  END LOOP;
  RETURN v_new;
END $function$
;

-- 9) "Tell client" drafts for a day-2+ alert use that day's start, en-route tap and leave-by (not day 1's).
--    The open draft is reused only for the same day, so a day-3 alert never reuses the day-2 wording.
CREATE OR REPLACE FUNCTION public.draft_client_job_message(p_job_id uuid, p_channel text, p_alert_id uuid DEFAULT NULL)
RETURNS public.job_client_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; m public.job_client_messages; v_plan jsonb; v_eta text; v_late boolean; v_when text;
  v_day date; v_start timestamptz; v_enr timestamptz;
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
  IF p_alert_id IS NOT NULL THEN
    SELECT work_date INTO v_day FROM job_alerts WHERE id = p_alert_id AND job_id = p_job_id;
  END IF;
  -- reuse an open draft for the same job + channel (+ same day for per-day alerts)
  SELECT * INTO m FROM job_client_messages cm WHERE cm.job_id = p_job_id AND cm.channel = p_channel AND cm.status = 'draft'
     AND (SELECT a.work_date FROM job_alerts a WHERE a.id = cm.alert_id) IS NOT DISTINCT FROM v_day
   ORDER BY cm.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN m; END IF;
  IF v_day IS NOT NULL THEN
    SELECT (s.scheduled_date + s.start_time) AT TIME ZONE 'Africa/Johannesburg' INTO v_start
      FROM job_schedules s WHERE s.job_id = p_job_id AND s.scheduled_date = v_day LIMIT 1;
    SELECT e.en_route_at INTO v_enr FROM job_time_entries e WHERE e.job_id = p_job_id AND e.work_date = v_day
     ORDER BY e.created_at DESC LIMIT 1;
    v_plan := public.job_day_en_route_plan(p_job_id, v_day);
  END IF;
  IF v_start IS NULL THEN
    v_start := j.scheduled_for; v_enr := j.en_route_at; v_plan := public.job_en_route_plan(p_job_id);
  END IF;
  v_when := to_char(v_start AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');
  v_late := now() > v_start;
  IF v_enr IS NOT NULL AND (v_plan->>'drive_minutes') IS NOT NULL THEN
    v_eta := to_char((greatest(now(), v_enr + make_interval(mins => (v_plan->>'drive_minutes')::int))
                      AT TIME ZONE 'Africa/Johannesburg'), 'HH24:MI');
  END IF;
  INSERT INTO job_client_messages (company_id, job_id, alert_id, channel, to_address, subject, body)
  VALUES (j.company_id, p_job_id, p_alert_id, p_channel,
    CASE WHEN p_channel = 'email' THEN j.email ELSE j.phone END,
    CASE WHEN p_channel = 'email' THEN 'Update on your ' || v_when || ' appointment – ' || j.company END,
    'Hi' || coalesce(' ' || nullif(j.first_name, ''), '') || ', this is ' || j.company || '. '
      || coalesce(split_part(j.tech, ' ', 1), 'Our technician') || ' is running '
      || CASE WHEN v_late THEN 'late' ELSE 'a little behind' END || ' for your ' || v_when || ' appointment '
      || CASE WHEN (v_start AT TIME ZONE 'Africa/Johannesburg')::date = (now() AT TIME ZONE 'Africa/Johannesburg')::date
              THEN 'today' ELSE 'on ' || to_char(v_start AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon') END || '. '
      || CASE WHEN v_eta IS NOT NULL THEN 'Expected arrival is around ' || v_eta || '. '
              ELSE 'We expect to arrive around [time]. ' END
      || 'Sorry for the inconvenience – please reply if that no longer suits you.')
  RETURNING * INTO m;
  RETURN m;
END $$;
