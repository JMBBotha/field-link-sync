-- Johan 1 Nov: multi-day visits on a booking (lead without a job) + PR #92 gaps.
-- Booking visits are job_schedules rows on the lead with job_id NULL (the same rows assign_lead_to_tech writes).
-- Admin / linked admin: add, edit, remove, per-visit tech, note. Client's rep: add + edit date/times/note; no remove, no tech change.

CREATE OR REPLACE FUNCTION public.booking_visits(p_lead uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE p jsonb := public.booking_edit_perms(p_lead); v_uid uuid := auth.uid();
BEGIN
  IF NOT ((p->>'admin')::boolean OR (p->>'rep')::boolean OR (public.is_ops_user(v_uid) AND NOT COALESCE(public.is_sales_rep(v_uid), false))
          OR EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = p_lead AND s.job_id IS NULL AND s.agent_id = v_uid)) THEN
    RAISE EXCEPTION 'Not your booking' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'date', s.scheduled_date, 'start', to_char(s.start_time,'HH24:MI'),
      'end', to_char(s.end_time,'HH24:MI'), 'tech', s.agent_id, 'tech_name', pr.full_name, 'note', s.notes, 'worked', false) ORDER BY s.scheduled_date, s.start_time)
    FROM public.job_schedules s LEFT JOIN public.profiles pr ON pr.id = s.agent_id WHERE s.lead_id = p_lead AND s.job_id IS NULL), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.set_booking_visits(p_lead uuid, p_visits jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; p jsonb; v_admin boolean; v jsonb; s public.job_schedules%ROWTYPE;
  v_n int; v_keep uuid[] := '{}'; v_old jsonb; v_new jsonb; v_tech uuid; v_d date; v_st time; v_en time; v_total int := 0; i int := 0; v_first record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = p_lead AND j.status NOT IN ('cancelled','canceled')) THEN
    RAISE EXCEPTION 'This booking is a job now — add visits on the job page'; END IF;
  p := public.booking_edit_perms(p_lead); v_admin := (p->>'admin')::boolean;
  IF NOT (v_admin OR (p->>'rep')::boolean) THEN RAISE EXCEPTION 'You can''t edit this booking' USING ERRCODE='42501'; END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' OR jsonb_array_length(p_visits) = 0 THEN RAISE EXCEPTION 'Add at least one visit'; END IF;
  v_n := jsonb_array_length(p_visits);
  IF v_n > 130 THEN RAISE EXCEPTION 'At most 130 visits'; END IF;
  IF (SELECT count(DISTINCT x->>'date') FROM jsonb_array_elements(p_visits) x) <> v_n THEN RAISE EXCEPTION 'Two visits on the same day — combine them or pick another date'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_old FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL;
  IF NOT v_admin AND EXISTS (SELECT 1 FROM public.job_schedules s2 WHERE s2.lead_id = p_lead AND s2.job_id IS NULL
       AND s2.id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL)) THEN
    RAISE EXCEPTION 'Only an admin can remove visits' USING ERRCODE='42501'; END IF;

  FOR v IN SELECT x FROM jsonb_array_elements(p_visits) x ORDER BY x->>'date' LOOP
    i := i + 1;
    BEGIN v_d := (v->>'date')::date; v_st := (v->>'start')::time; v_en := (v->>'end')::time;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Visit % has a bad date or time', i; END;
    IF v_d IS NULL OR v_st IS NULL OR v_en IS NULL THEN RAISE EXCEPTION 'Visit % needs a date, start and end', i; END IF;
    IF v_en <= v_st THEN RAISE EXCEPTION 'Visit on % ends before it starts', to_char(v_d, 'DD Mon'); END IF;
    v_total := v_total + (extract(epoch FROM (v_en - v_st)) / 60)::int;
    IF v->>'id' IS NOT NULL THEN
      SELECT * INTO s FROM public.job_schedules WHERE id = (v->>'id')::uuid AND lead_id = p_lead AND job_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Visit % is not on this booking', i; END IF;
      v_tech := CASE WHEN v_admin AND v ? 'tech' THEN COALESCE(nullif(v->>'tech','')::uuid, l.assigned_agent_id) ELSE s.agent_id END;
      UPDATE public.job_schedules SET scheduled_date = v_d, start_time = v_st, end_time = v_en, agent_id = v_tech,
             notes = CASE WHEN v ? 'note' THEN nullif(trim(v->>'note'), '') ELSE notes END,
             day_index = CASE WHEN v_n > 1 THEN i END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = s.id;
      v_keep := v_keep || s.id;
    ELSE
      v_tech := CASE WHEN v_admin THEN COALESCE(nullif(v->>'tech','')::uuid, l.assigned_agent_id) ELSE l.assigned_agent_id END;
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count)
        VALUES (p_lead, NULL, v_tech, v_d, v_st, v_en, nullif(trim(v->>'note'), ''), CASE WHEN v_n > 1 THEN i END, CASE WHEN v_n > 1 THEN v_n END)
        RETURNING id INTO s.id;
      v_keep := v_keep || s.id;
    END IF;
    IF v_tech IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_tech AND pr.company_id = l.company_id) THEN
      RAISE EXCEPTION 'Visit % tech is not in this company', i; END IF;
  END LOOP;
  DELETE FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL AND NOT (id = ANY (v_keep));
  SELECT scheduled_date, start_time INTO v_first FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL ORDER BY scheduled_date, start_time LIMIT 1;
  UPDATE public.leads SET scheduled_date = v_first.scheduled_date, scheduled_time = v_first.start_time WHERE id = p_lead;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_new FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL;
  IF v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('leads', p_lead, 'update', jsonb_build_object('source','set_booking_visits','visits', v_old),
              jsonb_build_object('source','set_booking_visits','visits', v_new, 'total_minutes', v_total, 'by_role', CASE WHEN v_admin THEN 'admin' ELSE 'rep' END), v_uid, l.company_id);
  END IF;
  RETURN jsonb_build_object('visits', v_new, 'total_minutes', v_total, 'changed', v_new IS DISTINCT FROM v_old);
END $function$;
REVOKE ALL ON FUNCTION public.booking_visits(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_booking_visits(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_visits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_booking_visits(uuid, jsonb) TO authenticated;

-- PR #92 gap: changing the job-wide tech only moves visits that followed the old job tech (or had none);
-- visits with their own tech keep it.
CREATE OR REPLACE FUNCTION public.sync_assignment_to_schedule()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_job record; v_local timestamp; v_dur interval;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF v_job.id IS NULL OR v_job.scheduled_for IS NULL OR v_job.lead_id IS NULL THEN RETURN NEW; END IF;
  v_local := v_job.scheduled_for AT TIME ZONE 'Africa/Johannesburg';
  v_dur := COALESCE(v_job.estimated_duration, interval '3 hours');
  UPDATE public.leads SET assigned_agent_id = NEW.profile_id, last_activity_at = now()
   WHERE id = v_job.lead_id AND assigned_agent_id IS NULL AND scheduled_date IS NULL
     AND COALESCE(v_job.job_type,'') <> 'installation';
  IF EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = NEW.job_id) THEN
    UPDATE public.job_schedules SET agent_id = NEW.profile_id, updated_at = now()
     WHERE job_id = NEW.job_id AND agent_id IS DISTINCT FROM NEW.profile_id
       AND (TG_OP = 'INSERT' OR agent_id IS NULL OR agent_id = OLD.profile_id);
  ELSE
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (v_job.lead_id, NEW.job_id, NEW.profile_id, v_local::date, v_local::time, public.booking_end_time(v_local::time, v_dur), v_job.description);
  END IF;
  RETURN NEW;
END $function$;

-- PR #92 gap: the client's rep may add visits (incl. the first one) and set visit notes.
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

  IF NOT v_admin AND EXISTS (SELECT 1 FROM public.job_schedules s2 WHERE s2.job_id = p_job
       AND s2.id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL)) THEN
    -- rep (PR #92 gap closed 1 Nov): may add visits and edit date/times/note, but not remove or change techs
    RAISE EXCEPTION 'Only an admin can remove visits' USING ERRCODE='42501'; END IF;

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
             notes = CASE WHEN v ? 'note' THEN nullif(trim(v->>'note'), '') ELSE notes END,
             day_index = CASE WHEN v_n > 1 THEN i END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = s.id;
      v_keep := v_keep || s.id;
    ELSE
      v_tech := CASE WHEN v_admin THEN COALESCE(nullif(v->>'tech','')::uuid, v_def_tech) ELSE v_def_tech END;
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
