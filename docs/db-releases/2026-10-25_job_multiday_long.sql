-- 0030 Multi-day jobs: long runs (weeks to months).
-- Additive/relaxing only: raises the per-job day cap from 30 to 130 working days (~6 months),
-- lets the planner look up to 400 calendar days ahead, adds a compact clash summary + expected end
-- to the plan, and seeds 2028 SA public holidays. No data is changed. Rollback: *_rollback.sql.

-- 1) Day cap on job_schedules: 30 -> 130 (relaxing; every existing row already passes)
ALTER TABLE public.job_schedules DROP CONSTRAINT IF EXISTS job_schedules_day_chk;
ALTER TABLE public.job_schedules ADD CONSTRAINT job_schedules_day_chk
  CHECK ((day_index IS NULL AND day_count IS NULL) OR (day_index >= 1 AND day_count >= day_index AND day_count <= 130));

-- 2) 2028 SA public holidays (24 Sep 2028 is a Sunday -> Monday 25 Sep observed)
INSERT INTO public.public_holidays (company_id, holiday_date, name, kind, created_by) VALUES
 (NULL,'2028-01-01','New Year''s Day','public',NULL),
 (NULL,'2028-03-21','Human Rights Day','public',NULL),
 (NULL,'2028-04-14','Good Friday','public',NULL),
 (NULL,'2028-04-17','Family Day','public',NULL),
 (NULL,'2028-04-27','Freedom Day','public',NULL),
 (NULL,'2028-05-01','Workers'' Day','public',NULL),
 (NULL,'2028-06-16','Youth Day','public',NULL),
 (NULL,'2028-08-09','National Women''s Day','public',NULL),
 (NULL,'2028-09-24','Heritage Day','public',NULL),
 (NULL,'2028-09-25','Heritage Day (observed)','public',NULL),
 (NULL,'2028-12-16','Day of Reconciliation','public',NULL),
 (NULL,'2028-12-25','Christmas Day','public',NULL),
 (NULL,'2028-12-26','Day of Goodwill','public',NULL)
ON CONFLICT ON CONSTRAINT public_holidays_day_key DO NOTHING;

-- 3) Planner: cap 130, 400-day look-ahead, clash summary, expected end, holiday-data warning
CREATE OR REPLACE FUNCTION public._job_days_plan(p_company uuid, p_job uuid, p_tech uuid, p_start date, p_days integer, p_end date, p_with_clashes boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_days jsonb := '[]'; v_skip jsonb := '[]'; v_worked int := 0; v_last date; d date; w record; v_n int := 0;
  v_target int; v_max constant int := 130; v_sum jsonb; v_hol_until date; v_clash jsonb; v_cd int := 0; v_total int := 0; v_guard int := 0; r record; v_admin boolean;
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
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > v_max) THEN RAISE EXCEPTION 'Pick between 1 and % working days (about 6 months)', v_max; END IF;
  IF p_days IS NULL AND p_end IS NULL THEN RAISE EXCEPTION 'Give a number of days or an end date'; END IF;
  IF p_end IS NOT NULL AND p_end < p_start THEN RAISE EXCEPTION 'The end date is before the start date'; END IF;
  IF v_last IS NOT NULL AND p_start <= v_last THEN
    RAISE EXCEPTION 'Day % was already worked on % — the remaining days must start after it', v_worked, to_char(v_last, 'DD Mon');
  END IF;
  v_target := COALESCE(p_days, v_max + 1);  -- end-date mode: one extra so a too-long range is reported, not cut
  d := p_start;
  WHILE v_n < v_target LOOP
    EXIT WHEN p_end IS NOT NULL AND d > p_end;
    v_guard := v_guard + 1;
    IF v_guard > 400 THEN RAISE EXCEPTION 'Could not find enough working days in the next 13 months'; END IF;
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
  IF v_n > v_max THEN RAISE EXCEPTION 'That range has more than % working days (about 6 months). Pick an earlier end date', v_max; END IF;
  IF p_days IS NOT NULL AND v_n < p_days THEN RAISE EXCEPTION 'Only % working day(s) fit before %', v_n, to_char(p_end, 'DD Mon'); END IF;
  -- Compact clash summary for long runs: first clash dates + bookings grouped by label (day counts).
  IF v_cd > 0 THEN
    WITH c AS (
      SELECT (x->>'day_index')::int AS di, (x->>'date')::date AS dt, y->>'label' AS label
        FROM jsonb_array_elements(v_days) x CROSS JOIN LATERAL jsonb_array_elements(x->'clashes') y),
    g AS (SELECT label, count(DISTINCT dt) AS n, min(dt) AS f, max(dt) AS l FROM c GROUP BY label)
    SELECT jsonb_build_object(
      'days', v_cd,
      'first', (SELECT min(dt) FROM c), 'last', (SELECT max(dt) FROM c),
      'dates', (SELECT jsonb_agg(dt ORDER BY dt) FROM (SELECT DISTINCT dt FROM c ORDER BY dt LIMIT 12) t),
      'more_dates', GREATEST(v_cd - 12, 0),
      'by_label', (SELECT jsonb_agg(jsonb_build_object('label', label, 'days', n, 'first', f, 'last', l) ORDER BY n DESC, f)
                     FROM (SELECT * FROM g ORDER BY n DESC, f LIMIT 6) t),
      'more_labels', GREATEST((SELECT count(*) FROM g) - 6, 0))
      INTO v_sum;
  END IF;
  SELECT max(holiday_date) INTO v_hol_until FROM public.public_holidays WHERE company_id IS NULL;
  RETURN jsonb_build_object('days', v_days, 'day_count', v_n, 'skipped', v_skip, 'clash_days', v_cd,
    'total_minutes', v_total, 'first', v_days->0->>'date', 'last', v_days->(v_n - 1)->>'date',
    'expected_end', v_days->(v_n - 1)->>'date', 'max_days', v_max, 'clash_summary', v_sum,
    'holidays_known_until', v_hol_until,
    'holidays_unknown', v_hol_until IS NULL OR (v_days->(v_n - 1)->>'date')::date > v_hol_until);
END $function$
;

-- 4) "Add a day": cap 130
CREATE OR REPLACE FUNCTION public.job_add_day(p_job_id uuid, p_force boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_n >= 130 THEN RAISE EXCEPTION 'A job can run for at most 130 working days (about 6 months)'; END IF;
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
END $function$
;
