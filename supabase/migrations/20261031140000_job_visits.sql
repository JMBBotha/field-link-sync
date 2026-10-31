-- Johan 31 Oct (t2009u): a job over several visits, each with its own date, start AND end hours.
-- Builds on phase (b) multi-day runs: one job_schedules row per visit (day_index/day_count), which the dispatch
-- board, schedule calendar and tech Today list already read per day. This adds free-form hours per visit.
-- visits: [{id?, date 'YYYY-MM-DD', start 'HH:MM', end 'HH:MM', tech? uuid, note? text}]
-- Admin (incl. linked admin): add / edit / remove, per-visit tech. Client's rep: date + times of existing visits only.
CREATE OR REPLACE FUNCTION public.set_job_visits(p_job uuid, p_visits jsonb, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); j public.jobs%ROWTYPE; v_admin boolean; v_rep boolean; v jsonb; s public.job_schedules%ROWTYPE;
  v_n int; v_keep uuid[] := '{}'; v_old jsonb; v_new jsonb; v_tech uuid; v_def_tech uuid; v_d date; v_st time; v_en time;
  v_total int := 0; v_first record; v_last record; v_prev text; i int := 0; v_worked boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Job not found' USING ERRCODE='42501'; END IF;
  IF j.lead_id IS NULL THEN RAISE EXCEPTION 'Visits need a client lead on the job'; END IF;
  v_admin := public.fl_job_admin_ok(v_uid, j.company_id);
  v_rep := j.customer_id IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, j.customer_id, j.company_id), false);
  IF NOT (v_admin OR v_rep) THEN RAISE EXCEPTION 'You can''t edit this job' USING ERRCODE='42501'; END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' OR jsonb_array_length(p_visits) = 0 THEN RAISE EXCEPTION 'Add at least one visit'; END IF;
  v_n := jsonb_array_length(p_visits);
  IF v_n > 130 THEN RAISE EXCEPTION 'At most 130 visits'; END IF;
  IF (SELECT count(DISTINCT x->>'date') FROM jsonb_array_elements(p_visits) x) <> v_n THEN RAISE EXCEPTION 'Two visits on the same day — combine them or pick another date'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_old FROM public.job_schedules WHERE job_id = p_job;
  SELECT profile_id INTO v_def_tech FROM public.assignments WHERE job_id = p_job ORDER BY created_at ASC LIMIT 1;

  IF NOT v_admin THEN
    -- rep: same visits (ids), only date/start/end may change
    IF v_n <> jsonb_array_length(v_old) OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_visits) x
         WHERE (x->>'id') IS NULL OR NOT EXISTS (SELECT 1 FROM public.job_schedules s2 WHERE s2.id = (x->>'id')::uuid AND s2.job_id = p_job)) THEN
      RAISE EXCEPTION 'Only an admin can add or remove visits' USING ERRCODE='42501'; END IF;
  END IF;

  -- removed visits: not allowed when the tech already checked in that day
  FOR s IN SELECT * FROM public.job_schedules WHERE job_id = p_job
            AND id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL) LOOP
    IF EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = p_job AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL) THEN
      RAISE EXCEPTION 'The % visit has a check-in and can''t be removed', to_char(s.scheduled_date, 'DD Mon'); END IF;
  END LOOP;

  FOR v IN SELECT x FROM jsonb_array_elements(p_visits) x ORDER BY x->>'date' LOOP
    i := i + 1;
    BEGIN v_d := (v->>'date')::date; v_st := (v->>'start')::time; v_en := (v->>'end')::time;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Visit % has a bad date or time', i; END;
    IF v_d IS NULL OR v_st IS NULL OR v_en IS NULL THEN RAISE EXCEPTION 'Visit % needs a date, start and end', i; END IF;
    IF v_en <= v_st THEN RAISE EXCEPTION 'Visit on % ends before it starts', to_char(v_d, 'DD Mon'); END IF;
    v_total := v_total + (extract(epoch FROM (v_en - v_st)) / 60)::int;
    v_tech := NULL;
    IF v->>'id' IS NOT NULL THEN
      SELECT * INTO s FROM public.job_schedules WHERE id = (v->>'id')::uuid AND job_id = p_job;
      IF NOT FOUND THEN RAISE EXCEPTION 'Visit % is not on this job', i; END IF;
      v_worked := EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = p_job AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL);
      IF v_worked AND v_d <> s.scheduled_date THEN RAISE EXCEPTION 'The % visit has a check-in; its date can''t move', to_char(s.scheduled_date, 'DD Mon'); END IF;
      v_tech := CASE WHEN v_admin AND v ? 'tech' THEN nullif(v->>'tech','')::uuid ELSE s.agent_id END;
      UPDATE public.job_schedules SET scheduled_date = v_d, start_time = v_st, end_time = v_en, agent_id = COALESCE(v_tech, s.agent_id, v_def_tech),
             notes = CASE WHEN v_admin AND v ? 'note' THEN nullif(trim(v->>'note'), '') ELSE notes END,
             day_index = CASE WHEN v_n > 1 THEN i END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = s.id;
      v_keep := v_keep || s.id;
    ELSE
      v_tech := COALESCE(nullif(v->>'tech','')::uuid, v_def_tech);
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count)
        VALUES (j.lead_id, p_job, v_tech, v_d, v_st, v_en, COALESCE(nullif(trim(v->>'note'), ''), j.title),
                CASE WHEN v_n > 1 THEN i END, CASE WHEN v_n > 1 THEN v_n END)
        RETURNING id INTO s.id;
      v_keep := v_keep || s.id;
    END IF;
    IF v_tech IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_tech AND p.company_id = j.company_id) THEN
      RAISE EXCEPTION 'Visit % tech is not in this company', i; END IF;
  END LOOP;
  DELETE FROM public.job_schedules WHERE job_id = p_job AND NOT (id = ANY (v_keep));

  SELECT scheduled_date, start_time INTO v_first FROM public.job_schedules WHERE job_id = p_job ORDER BY scheduled_date LIMIT 1;
  SELECT scheduled_date, end_time INTO v_last FROM public.job_schedules WHERE job_id = p_job ORDER BY scheduled_date DESC LIMIT 1;
  v_prev := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.job_days_writing', '1', true);   -- the visit rows are the source of truth; don't let sync_job_schedule re-plan them
  UPDATE public.jobs SET
    scheduled_for = (v_first.scheduled_date + v_first.start_time) AT TIME ZONE 'Africa/Johannesburg',
    scheduled_until = CASE WHEN v_n > 1 THEN (v_last.scheduled_date + v_last.end_time) AT TIME ZONE 'Africa/Johannesburg' END,
    estimated_duration = make_interval(mins => v_total), updated_at = now()
   WHERE id = p_job;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_new FROM public.job_schedules WHERE job_id = p_job;
  IF v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.job_activity_log(job_id, user_id, action, details)
      VALUES (p_job, v_uid, 'visits_updated', jsonb_build_object('from', v_old, 'to', v_new, 'total_minutes', v_total, 'by_role', CASE WHEN v_admin THEN 'admin' ELSE 'rep' END));
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('jobs', p_job, 'update', jsonb_build_object('visits', v_old, 'scheduled_for', j.scheduled_for, 'scheduled_until', j.scheduled_until, 'estimated_duration', j.estimated_duration),
              jsonb_build_object('event', 'set_job_visits', 'visits', v_new, 'total_minutes', v_total), v_uid, j.company_id);
  END IF;
  IF nullif(trim(coalesce(p_note,'')), '') IS NOT NULL THEN
    INSERT INTO public.job_activity_log(job_id, user_id, action, details) VALUES (p_job, v_uid, 'note_added', jsonb_build_object('note', left(trim(p_note), 2000)));
  END IF;
  RETURN jsonb_build_object('visits', v_new, 'total_minutes', v_total, 'changed', v_new IS DISTINCT FROM v_old);
END $function$;
REVOKE ALL ON FUNCTION public.set_job_visits(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_job_visits(uuid, jsonb, text) TO authenticated;

-- Visit list for anyone who may edit or work the job (ops, assigned tech, client's rep, linked admin).
CREATE OR REPLACE FUNCTION public.job_visits(p_job uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE j public.jobs%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF NOT FOUND OR v_uid IS NULL OR j.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Job not found' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_ops_user(v_uid) OR public.fl_job_admin_ok(v_uid, j.company_id)
          OR (j.customer_id IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, j.customer_id, j.company_id), false))
          OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job AND a.profile_id = v_uid)) THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'date', s.scheduled_date, 'start', to_char(s.start_time,'HH24:MI'),
      'end', to_char(s.end_time,'HH24:MI'), 'tech', s.agent_id, 'tech_name', p.full_name, 'note', s.notes,
      'worked', EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = p_job AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL))
      ORDER BY s.scheduled_date)
    FROM public.job_schedules s LEFT JOIN public.profiles p ON p.id = s.agent_id WHERE s.job_id = p_job), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.job_visits(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_visits(uuid) TO authenticated;
