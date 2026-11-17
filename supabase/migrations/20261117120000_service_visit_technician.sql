-- Service visits: the lead owner is not the technician.
-- A person is written to job_schedules.agent_id only when _company_tech_ok says they are a company technician.
-- Otherwise the visit is stored with agent_id null and no_technician true.
-- This file does not update existing job_schedules, leads, invoices or payments.
-- The Tracy Wittstock visit is left as it is until a later edit writes it through these functions.

ALTER TABLE public.job_schedules
  ADD COLUMN IF NOT EXISTS no_technician boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.job_schedules.no_technician IS
  'Service visit booked with no company technician. Existing rows stay false until a later write. The app also treats a non-technician agent_id as no technician.';

-- Service / repair / install needs a technician. A sales or quote visit does not.
CREATE OR REPLACE FUNCTION public._booking_is_service(p_intent text, p_service text, p_job_types text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_intent, '')) IN ('sales', 'quote') THEN false
    WHEN lower(coalesce(p_service, '')) ~ '(sales visit|quote visit|consult|survey)'
         AND lower(coalesce(p_service, '')) !~ '(service|repair|install|call)' THEN false
    WHEN lower(coalesce(p_intent, '')) IN ('service', 'repair', 'installation', 'technical') THEN true
    WHEN coalesce(p_job_types, '{}'::text[]) && ARRAY['service', 'repair', 'installation']::text[] THEN true
    WHEN lower(coalesce(p_service, '')) ~ '(service|repair|install|call|fault|maintenance|commission|technical)' THEN true
    ELSE false
  END;
$$;

-- Service bookings keep agent_id only for a company technician. Sales visits keep their salesperson.
CREATE OR REPLACE FUNCTION public._visit_tech_id(p_person uuid, p_company uuid, p_service boolean)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_person IS NULL THEN NULL
    WHEN NOT coalesce(p_service, false) THEN p_person
    WHEN public._company_tech_ok(p_person, p_company) THEN p_person
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public._booking_is_service(text, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._visit_tech_id(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._booking_is_service(text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public._visit_tech_id(uuid, uuid, boolean) TO authenticated;

-- Safety net for every writer: a service visit cannot keep a salesperson in agent_id.
CREATE OR REPLACE FUNCTION public.trg_job_schedule_tech_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company uuid;
  v_intent text;
  v_service text;
  v_types text[];
  v_job_type text;
  v_is_service boolean;
BEGIN
  SELECT l.company_id, l.primary_intent::text, l.service_type, l.job_types
    INTO v_company, v_intent, v_service, v_types
    FROM public.leads l WHERE l.id = NEW.lead_id;
  IF NEW.job_id IS NOT NULL THEN
    SELECT j.company_id, j.job_type INTO v_company, v_job_type
      FROM public.jobs j WHERE j.id = NEW.job_id;
  END IF;
  v_is_service := public._booking_is_service(v_intent, coalesce(v_job_type, v_service), v_types);
  IF v_is_service AND NEW.agent_id IS NOT NULL AND NOT public._company_tech_ok(NEW.agent_id, v_company) THEN
    NEW.agent_id := NULL;
  END IF;
  NEW.no_technician := v_is_service AND NEW.agent_id IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_schedule_tech_only ON public.job_schedules;
CREATE TRIGGER trg_job_schedule_tech_only
  BEFORE INSERT OR UPDATE OF agent_id, lead_id, job_id, scheduled_date, start_time, end_time
  ON public.job_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_job_schedule_tech_only();

-- Lead date edits. A salesperson on the lead is not copied onto the visit.
CREATE OR REPLACE FUNCTION public.sync_lead_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_dur interval;
  v_start time;
  v_service boolean;
  v_agent uuid;
BEGIN
  IF NEW.status IN ('completed', 'cancelled') OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM public.job_schedules WHERE lead_id = NEW.id AND job_id IS NULL ORDER BY created_at ASC LIMIT 1;
  v_service := public._booking_is_service(NEW.primary_intent::text, NEW.service_type, NEW.job_types);
  v_agent := public._visit_tech_id(NEW.assigned_agent_id, NEW.company_id, v_service);
  IF NEW.scheduled_date IS NULL OR (NOT v_service AND NEW.assigned_agent_id IS NULL) THEN
    IF r.id IS NOT NULL THEN DELETE FROM public.job_schedules WHERE id = r.id; END IF;
    RETURN NEW;
  END IF;
  v_dur := COALESCE(
    CASE WHEN TG_OP = 'UPDATE' AND NEW.estimated_duration_minutes IS NOT NULL
              AND NEW.estimated_duration_minutes IS DISTINCT FROM OLD.estimated_duration_minutes
         THEN make_interval(mins => NEW.estimated_duration_minutes) END,
    CASE WHEN r.id IS NOT NULL AND r.end_time > r.start_time THEN r.end_time - r.start_time END,
    make_interval(mins => NEW.estimated_duration_minutes),
    make_interval(mins => public.default_booking_minutes(
      CASE WHEN NEW.primary_intent::text = 'sales' THEN 'sales' ELSE COALESCE(NEW.service_type, 'sales') END)));
  v_start := COALESCE(NEW.scheduled_time, r.start_time, '08:00'::time);
  IF r.id IS NULL THEN
    INSERT INTO public.job_schedules (lead_id, agent_id, scheduled_date, start_time, end_time, no_technician)
    VALUES (NEW.id, v_agent, NEW.scheduled_date, v_start, public.booking_end_time(v_start, v_dur), v_service AND v_agent IS NULL);
  ELSIF r.scheduled_date IS DISTINCT FROM NEW.scheduled_date OR r.start_time IS DISTINCT FROM v_start
        OR r.agent_id IS DISTINCT FROM v_agent
        OR r.end_time IS DISTINCT FROM public.booking_end_time(v_start, v_dur)
        OR r.no_technician IS DISTINCT FROM (v_service AND v_agent IS NULL) THEN
    UPDATE public.job_schedules
       SET scheduled_date = NEW.scheduled_date, start_time = v_start,
           end_time = public.booking_end_time(v_start, v_dur), agent_id = v_agent,
           no_technician = v_service AND v_agent IS NULL, updated_at = now()
     WHERE id = r.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Named technician must pass _company_tech_ok. A blank tech stays null (book without a technician).
CREATE OR REPLACE FUNCTION public.set_booking_visits(p_lead uuid, p_visits jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  l public.leads%ROWTYPE;
  p jsonb;
  v_admin boolean;
  v jsonb;
  s public.job_schedules%ROWTYPE;
  v_n int;
  v_keep uuid[] := '{}';
  v_old jsonb;
  v_new jsonb;
  v_tech uuid;
  v_d date;
  v_st time;
  v_en time;
  v_total int := 0;
  i int := 0;
  v_first record;
  v_service boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = p_lead AND j.status NOT IN ('cancelled', 'canceled')) THEN
    RAISE EXCEPTION 'This booking is a job now — add visits on the job page';
  END IF;
  p := public.booking_edit_perms(p_lead);
  v_admin := (p->>'admin')::boolean;
  IF NOT (v_admin OR (p->>'rep')::boolean) THEN RAISE EXCEPTION 'You can''t edit this booking' USING ERRCODE = '42501'; END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' THEN RAISE EXCEPTION 'Add at least one visit'; END IF;
  v_n := jsonb_array_length(p_visits);
  IF v_n > 130 THEN RAISE EXCEPTION 'At most 130 visits'; END IF;
  IF (SELECT count(DISTINCT x->>'date') FROM jsonb_array_elements(p_visits) x) <> v_n THEN
    RAISE EXCEPTION 'Two visits on the same day — combine them or pick another date';
  END IF;
  v_service := public._booking_is_service(l.primary_intent::text, l.service_type, l.job_types);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_old FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL;
  IF NOT v_admin AND EXISTS (
    SELECT 1 FROM public.job_schedules s2 WHERE s2.lead_id = p_lead AND s2.job_id IS NULL
      AND s2.id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL)) THEN
    RAISE EXCEPTION 'Only an admin can remove visits' USING ERRCODE = '42501';
  END IF;

  FOR v IN SELECT x FROM jsonb_array_elements(p_visits) x ORDER BY x->>'date' LOOP
    i := i + 1;
    BEGIN
      v_d := (v->>'date')::date; v_st := (v->>'start')::time; v_en := (v->>'end')::time;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Visit % has a bad date or time', i;
    END;
    IF v_d IS NULL OR v_st IS NULL OR v_en IS NULL THEN RAISE EXCEPTION 'Visit % needs a date, start and end', i; END IF;
    IF v_en <= v_st THEN RAISE EXCEPTION 'Visit on % ends before it starts', to_char(v_d, 'DD Mon'); END IF;
    v_total := v_total + (extract(epoch FROM (v_en - v_st)) / 60)::int;
    IF v->>'id' IS NOT NULL THEN
      SELECT * INTO s FROM public.job_schedules WHERE id = (v->>'id')::uuid AND lead_id = p_lead AND job_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Visit % is not on this booking', i; END IF;
      IF v_admin AND v ? 'tech' THEN
        IF nullif(v->>'tech', '') IS NULL THEN
          v_tech := NULL;
        ELSE
          v_tech := (v->>'tech')::uuid;
          IF NOT public._company_tech_ok(v_tech, l.company_id) THEN
            RAISE EXCEPTION 'Visit % needs a technician in this company', i;
          END IF;
        END IF;
      ELSE
        v_tech := public._visit_tech_id(s.agent_id, l.company_id, v_service);
      END IF;
      UPDATE public.job_schedules
         SET scheduled_date = v_d, start_time = v_st, end_time = v_en, agent_id = v_tech,
             no_technician = v_service AND v_tech IS NULL,
             notes = CASE WHEN v ? 'note' THEN nullif(trim(v->>'note'), '') ELSE notes END,
             day_index = CASE WHEN v_n > 1 THEN i END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = s.id;
      v_keep := v_keep || s.id;
    ELSE
      IF v_admin AND v ? 'tech' AND nullif(v->>'tech', '') IS NOT NULL THEN
        v_tech := (v->>'tech')::uuid;
        IF NOT public._company_tech_ok(v_tech, l.company_id) THEN
          RAISE EXCEPTION 'Visit % needs a technician in this company', i;
        END IF;
      ELSIF v_admin AND v ? 'tech' THEN
        v_tech := NULL;
      ELSE
        v_tech := public._visit_tech_id(l.assigned_agent_id, l.company_id, v_service);
      END IF;
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count, no_technician)
      VALUES (p_lead, NULL, v_tech, v_d, v_st, v_en, nullif(trim(v->>'note'), ''),
              CASE WHEN v_n > 1 THEN i END, CASE WHEN v_n > 1 THEN v_n END, v_service AND v_tech IS NULL)
      RETURNING id INTO s.id;
      v_keep := v_keep || s.id;
    END IF;
  END LOOP;
  DELETE FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL AND NOT (id = ANY (v_keep));
  SELECT scheduled_date, start_time INTO v_first FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL ORDER BY scheduled_date, start_time LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.leads SET scheduled_date = NULL, scheduled_time = NULL WHERE id = p_lead;
  ELSE
    UPDATE public.leads SET scheduled_date = v_first.scheduled_date, scheduled_time = v_first.start_time WHERE id = p_lead;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_new FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL;
  IF v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('leads', p_lead, 'update', jsonb_build_object('source', 'set_booking_visits', 'visits', v_old),
            jsonb_build_object('source', 'set_booking_visits', 'visits', v_new, 'total_minutes', v_total, 'by_role', CASE WHEN v_admin THEN 'admin' ELSE 'rep' END), v_uid, l.company_id);
  END IF;
  RETURN jsonb_build_object('visits', v_new, 'total_minutes', v_total, 'changed', v_new IS DISTINCT FROM v_old);
END;
$$;

-- Same rule on job visits: a given technician must be a company technician. Blank stays null.
CREATE OR REPLACE FUNCTION public.set_job_visits(p_job uuid, p_visits jsonb, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  j public.jobs%ROWTYPE;
  v_admin boolean;
  v_rep boolean;
  v jsonb;
  s public.job_schedules%ROWTYPE;
  v_n int;
  v_keep uuid[] := '{}';
  v_old jsonb;
  v_new jsonb;
  v_tech uuid;
  v_def_tech uuid;
  v_d date;
  v_st time;
  v_en time;
  v_total int := 0;
  v_first record;
  v_last record;
  v_prev text;
  i int := 0;
  v_worked boolean;
  v_intent text;
  v_service text;
  v_types text[];
  v_is_service boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501'; END IF;
  IF j.lead_id IS NULL THEN RAISE EXCEPTION 'Visits need a client lead on the job'; END IF;
  v_admin := public.fl_job_admin_ok(v_uid, j.company_id);
  v_rep := j.customer_id IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, j.customer_id, j.company_id), false);
  IF NOT (v_admin OR v_rep) THEN RAISE EXCEPTION 'You can''t edit this job' USING ERRCODE = '42501'; END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' OR jsonb_array_length(p_visits) = 0 THEN RAISE EXCEPTION 'Add at least one visit'; END IF;
  v_n := jsonb_array_length(p_visits);
  IF v_n > 130 THEN RAISE EXCEPTION 'At most 130 visits'; END IF;
  IF (SELECT count(DISTINCT x->>'date') FROM jsonb_array_elements(p_visits) x) <> v_n THEN
    RAISE EXCEPTION 'Two visits on the same day — combine them or pick another date';
  END IF;
  SELECT l.primary_intent::text, l.service_type, l.job_types INTO v_intent, v_service, v_types FROM public.leads l WHERE l.id = j.lead_id;
  v_is_service := public._booking_is_service(v_intent, coalesce(j.job_type, v_service), v_types);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_old FROM public.job_schedules WHERE job_id = p_job;
  SELECT profile_id INTO v_def_tech FROM public.assignments WHERE job_id = p_job AND coalesce(status, '') <> 'rejected' ORDER BY created_at ASC LIMIT 1;
  v_def_tech := public._visit_tech_id(v_def_tech, j.company_id, true);

  IF NOT v_admin AND EXISTS (
    SELECT 1 FROM public.job_schedules s2 WHERE s2.job_id = p_job
      AND s2.id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL)) THEN
    RAISE EXCEPTION 'Only an admin can remove visits' USING ERRCODE = '42501';
  END IF;

  FOR s IN SELECT * FROM public.job_schedules WHERE job_id = p_job
            AND id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL) LOOP
    IF EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = p_job AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL) THEN
      RAISE EXCEPTION 'The % visit has a check-in and can''t be removed', to_char(s.scheduled_date, 'DD Mon');
    END IF;
  END LOOP;

  FOR v IN SELECT x FROM jsonb_array_elements(p_visits) x ORDER BY x->>'date' LOOP
    i := i + 1;
    BEGIN
      v_d := (v->>'date')::date; v_st := (v->>'start')::time; v_en := (v->>'end')::time;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Visit % has a bad date or time', i;
    END;
    IF v_d IS NULL OR v_st IS NULL OR v_en IS NULL THEN RAISE EXCEPTION 'Visit % needs a date, start and end', i; END IF;
    IF v_en <= v_st THEN RAISE EXCEPTION 'Visit on % ends before it starts', to_char(v_d, 'DD Mon'); END IF;
    v_total := v_total + (extract(epoch FROM (v_en - v_st)) / 60)::int;
    v_tech := NULL;
    IF v->>'id' IS NOT NULL THEN
      SELECT * INTO s FROM public.job_schedules WHERE id = (v->>'id')::uuid AND job_id = p_job;
      IF NOT FOUND THEN RAISE EXCEPTION 'Visit % is not on this job', i; END IF;
      v_worked := EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = p_job AND e.work_date = s.scheduled_date AND e.checked_in_at IS NOT NULL);
      IF v_worked AND v_d <> s.scheduled_date THEN
        RAISE EXCEPTION 'The % visit has a check-in; its date can''t move', to_char(s.scheduled_date, 'DD Mon');
      END IF;
      IF v_admin AND v ? 'tech' THEN
        IF nullif(v->>'tech', '') IS NULL THEN
          v_tech := NULL;
        ELSE
          v_tech := (v->>'tech')::uuid;
          IF NOT public._company_tech_ok(v_tech, j.company_id) THEN
            RAISE EXCEPTION 'Visit % needs a technician in this company', i;
          END IF;
        END IF;
      ELSE
        v_tech := public._visit_tech_id(coalesce(s.agent_id, v_def_tech), j.company_id, true);
      END IF;
      UPDATE public.job_schedules
         SET scheduled_date = v_d, start_time = v_st, end_time = v_en, agent_id = v_tech,
             no_technician = v_is_service AND v_tech IS NULL,
             notes = CASE WHEN v ? 'note' THEN nullif(trim(v->>'note'), '') ELSE notes END,
             day_index = CASE WHEN v_n > 1 THEN i END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = s.id;
      v_keep := v_keep || s.id;
    ELSE
      IF v_admin AND v ? 'tech' AND nullif(v->>'tech', '') IS NOT NULL THEN
        v_tech := (v->>'tech')::uuid;
        IF NOT public._company_tech_ok(v_tech, j.company_id) THEN
          RAISE EXCEPTION 'Visit % needs a technician in this company', i;
        END IF;
      ELSIF v_admin AND v ? 'tech' THEN
        v_tech := NULL;
      ELSE
        v_tech := v_def_tech;
      END IF;
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count, no_technician)
      VALUES (j.lead_id, p_job, v_tech, v_d, v_st, v_en, COALESCE(nullif(trim(v->>'note'), ''), j.title),
              CASE WHEN v_n > 1 THEN i END, CASE WHEN v_n > 1 THEN v_n END, v_is_service AND v_tech IS NULL)
      RETURNING id INTO s.id;
      v_keep := v_keep || s.id;
    END IF;
  END LOOP;
  DELETE FROM public.job_schedules WHERE job_id = p_job AND NOT (id = ANY (v_keep));

  SELECT scheduled_date, start_time INTO v_first FROM public.job_schedules WHERE job_id = p_job ORDER BY scheduled_date LIMIT 1;
  SELECT scheduled_date, end_time INTO v_last FROM public.job_schedules WHERE job_id = p_job ORDER BY scheduled_date DESC LIMIT 1;
  v_prev := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  UPDATE public.jobs SET
    scheduled_for = (v_first.scheduled_date + v_first.start_time) AT TIME ZONE 'Africa/Johannesburg',
    scheduled_until = CASE WHEN v_n > 1 THEN (v_last.scheduled_date + v_last.end_time) AT TIME ZONE 'Africa/Johannesburg' END,
    estimated_duration = make_interval(mins => v_total), updated_at = now()
  WHERE id = p_job;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_new FROM public.job_schedules WHERE job_id = p_job;
  IF v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.job_activity_log(job_id, user_id, action, details)
    VALUES (p_job, v_uid, 'visits_updated', jsonb_build_object('from', v_old, 'to', v_new, 'total_minutes', v_total, 'by_role', CASE WHEN v_admin THEN 'admin' ELSE 'rep' END));
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('jobs', p_job, 'update', jsonb_build_object('visits', v_old, 'scheduled_for', j.scheduled_for, 'scheduled_until', j.scheduled_until, 'estimated_duration', j.estimated_duration),
            jsonb_build_object('event', 'set_job_visits', 'visits', v_new, 'total_minutes', v_total), v_uid, j.company_id);
  END IF;
  IF nullif(trim(coalesce(p_note, '')), '') IS NOT NULL THEN
    INSERT INTO public.job_activity_log(job_id, user_id, action, details)
    VALUES (p_job, v_uid, 'note_added', jsonb_build_object('note', left(trim(p_note), 2000)));
  END IF;
  RETURN jsonb_build_object('visits', v_new, 'total_minutes', v_total, 'changed', v_new IS DISTINCT FROM v_old);
END;
$$;

-- Preview and book: a named person must be a technician. Null still means no technician.
CREATE OR REPLACE FUNCTION public.preview_job_days(p_tech_id uuid, p_start_date date, p_days integer DEFAULT NULL,
  p_end_date date DEFAULT NULL, p_job_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR v_co IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id AND company_id = v_co) THEN
    RAISE EXCEPTION 'Not your company' USING ERRCODE = '42501';
  END IF;
  IF p_tech_id IS NOT NULL AND NOT (public.rh_ops_ok(v_co) OR p_tech_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the office can check a technician''s days' USING ERRCODE = '42501';
  END IF;
  IF p_tech_id IS NOT NULL AND NOT public._company_tech_ok(p_tech_id, v_co) THEN
    RAISE EXCEPTION 'Pick a technician in this company';
  END IF;
  RETURN public._job_days_plan(v_co, p_job_id, p_tech_id, p_start_date, p_days, p_end_date, p_tech_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_job_days(p_job_id uuid, p_tech_id uuid, p_start_date date, p_days integer DEFAULT NULL,
  p_end_date date DEFAULT NULL, p_dry_run boolean DEFAULT false, p_force boolean DEFAULT false, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE j record; v_plan jsonb; v_tname text; v_cust text; v_body text;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF auth.uid() IS NULL OR NOT public.rh_ops_ok(j.company_id) THEN
    RAISE EXCEPTION 'Only the office can book multi-day jobs' USING ERRCODE = '42501';
  END IF;
  IF j.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'This job is closed'; END IF;
  IF j.lead_id IS NULL THEN RAISE EXCEPTION 'Multi-day jobs need a client lead on the job'; END IF;
  IF p_start_date IS NULL THEN RAISE EXCEPTION 'Pick a start date'; END IF;
  IF p_tech_id IS NOT NULL AND NOT public._company_tech_ok(p_tech_id, j.company_id) THEN
    RAISE EXCEPTION 'Pick a technician in this company';
  END IF;
  v_plan := public._job_days_plan(j.company_id, j.id, p_tech_id, p_start_date, p_days, p_end_date, true);
  IF p_dry_run THEN RETURN v_plan || jsonb_build_object('ok', true, 'dry_run', true); END IF;
  IF (v_plan->>'clash_days')::int > 0 THEN
    IF NOT p_force THEN
      RETURN v_plan || jsonb_build_object('ok', false, 'message',
        'Clashes on ' || (v_plan->>'clash_days') || ' day' || CASE WHEN (v_plan->>'clash_days')::int = 1 THEN '' ELSE 's' END);
    END IF;
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Only an admin can book over a clash' USING ERRCODE = '42501';
    END IF;
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
END;
$$;

COMMENT ON FUNCTION public.create_portal_booking(uuid, text, text) IS
  'Unscheduled portal request. Does not write job_schedules and does not copy a person onto agent_id.';

-- One row per visit, level and person. A repeat insert does nothing.
CREATE TABLE IF NOT EXISTS public.service_no_tech_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.job_schedules(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  level text NOT NULL CHECK (level IN ('now', 'h48', 'h24')),
  user_id uuid NOT NULL,
  notification_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, level, user_id)
);
ALTER TABLE public.service_no_tech_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_no_tech_alerts_read ON public.service_no_tech_alerts;
CREATE POLICY service_no_tech_alerts_read ON public.service_no_tech_alerts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_company_admin(auth.uid(), company_id));
REVOKE INSERT, UPDATE, DELETE ON public.service_no_tech_alerts FROM anon, authenticated;

-- Admins and the lead's sales owner. One notification each, per level.
CREATE OR REPLACE FUNCTION public.fl_service_no_tech_notify(p_schedule uuid, p_level text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.job_schedules%ROWTYPE;
  l public.leads%ROWTYPE;
  j public.jobs%ROWTYPE;
  v_uid uuid;
  v_row uuid;
  v_nid uuid;
  v_start timestamptz;
  v_body text;
  v_n int := 0;
  v_service boolean;
  v_owner uuid;
  v_job_type text;
BEGIN
  IF p_level NOT IN ('now', 'h48', 'h24') THEN RETURN 0; END IF;
  SELECT * INTO s FROM public.job_schedules WHERE id = p_schedule;
  IF s.id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO l FROM public.leads WHERE id = s.lead_id;
  IF l.id IS NULL OR l.deleted_at IS NOT NULL THEN RETURN 0; END IF;
  IF lower(coalesce(l.status, '')) IN ('cancelled', 'canceled', 'completed', 'resolved_before_visit') THEN RETURN 0; END IF;
  IF s.job_id IS NOT NULL THEN
    SELECT * INTO j FROM public.jobs WHERE id = s.job_id;
    v_job_type := j.job_type;
    IF lower(coalesce(j.status, '')) IN ('cancelled', 'canceled', 'completed') THEN RETURN 0; END IF;
  END IF;
  v_service := public._booking_is_service(l.primary_intent::text, coalesce(v_job_type, l.service_type), l.job_types);
  IF NOT v_service THEN RETURN 0; END IF;
  IF s.agent_id IS NOT NULL AND public._company_tech_ok(s.agent_id, l.company_id) THEN RETURN 0; END IF;
  v_start := (s.scheduled_date + coalesce(s.start_time, time '08:00')) AT TIME ZONE 'Africa/Johannesburg';
  v_body := coalesce(l.customer_name, 'A client')
    || ' · ' || to_char(v_start AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon')
    || ' · ' || to_char(coalesce(s.start_time, time '08:00'), 'HH24:MI')
    || '–' || to_char(coalesce(s.end_time, public.booking_end_time(coalesce(s.start_time, time '08:00'), interval '3 hours')), 'HH24:MI')
    || ' · no technician';
  v_owner := CASE
    WHEN l.assigned_agent_id IS NOT NULL
     AND NOT public._company_tech_ok(l.assigned_agent_id, l.company_id)
     AND public.is_sales_rep(l.assigned_agent_id)
    THEN l.assigned_agent_id END;
  FOR v_uid IN
    SELECT DISTINCT u FROM (
      SELECT public.fl_company_admin_ids(l.company_id) AS u
      UNION ALL
      SELECT c.owner_rep_id FROM public.customers c WHERE c.id = l.customer_id AND c.company_id = l.company_id
      UNION ALL
      SELECT v_owner
    ) people
    WHERE u IS NOT NULL
  LOOP
    v_row := NULL;
    INSERT INTO public.service_no_tech_alerts (schedule_id, company_id, level, user_id)
    VALUES (s.id, l.company_id, p_level, v_uid)
    ON CONFLICT (schedule_id, level, user_id) DO NOTHING
    RETURNING id INTO v_row;
    IF v_row IS NULL THEN CONTINUE; END IF;
    v_nid := public.fl_alert_deliver(
      v_uid, 'job_no_technician', 'Service booked, no technician', v_body, l.id,
      jsonb_build_object('schedule_id', s.id, 'level', p_level, 'company_id', l.company_id, 'href', '/admin/bookings/' || l.id));
    UPDATE public.service_no_tech_alerts SET notification_id = v_nid WHERE id = v_row;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.fl_service_no_tech_mark_read(p_schedule uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.notifications n
     SET read = true
    FROM public.service_no_tech_alerts a
   WHERE a.schedule_id = p_schedule
     AND a.notification_id = n.id
     AND n.read IS NOT TRUE
     AND n.type = 'job_no_technician';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_service_no_tech_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_company uuid;
BEGIN
  SELECT l.company_id INTO v_company FROM public.leads l WHERE l.id = NEW.lead_id;
  IF v_company IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT j.company_id INTO v_company FROM public.jobs j WHERE j.id = NEW.job_id;
  END IF;
  IF NEW.agent_id IS NOT NULL AND public._company_tech_ok(NEW.agent_id, v_company) THEN
    PERFORM public.fl_service_no_tech_mark_read(NEW.id);
  ELSIF coalesce(NEW.no_technician, false) THEN
    PERFORM public.fl_service_no_tech_notify(NEW.id, 'now');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_no_tech_alert ON public.job_schedules;
CREATE TRIGGER trg_service_no_tech_alert
  AFTER INSERT OR UPDATE OF agent_id, no_technician, scheduled_date, start_time
  ON public.job_schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_service_no_tech_alert();

-- 48h and 24h reminders. The immediate notice is also filled in if the write trigger missed it.
-- Idempotent: UNIQUE (schedule_id, level, user_id) plus ON CONFLICT DO NOTHING.
CREATE OR REPLACE FUNCTION public.fl_service_no_tech_tick(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_start timestamptz;
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.scheduled_date, s.start_time, s.agent_id, l.company_id, l.primary_intent, l.service_type, l.job_types, j.job_type, j.status AS job_status, l.status AS lead_status
      FROM public.job_schedules s
      JOIN public.leads l ON l.id = s.lead_id
      LEFT JOIN public.jobs j ON j.id = s.job_id
     WHERE l.deleted_at IS NULL
       AND lower(coalesce(l.status, '')) NOT IN ('cancelled', 'canceled', 'completed', 'resolved_before_visit')
       AND (s.job_id IS NULL OR lower(coalesce(j.status, '')) NOT IN ('cancelled', 'canceled', 'completed'))
       AND public._booking_is_service(l.primary_intent::text, coalesce(j.job_type, l.service_type), l.job_types)
       AND (s.agent_id IS NULL OR NOT public._company_tech_ok(s.agent_id, l.company_id))
       AND s.scheduled_date IS NOT NULL
  LOOP
    v_start := (r.scheduled_date + coalesce(r.start_time, time '08:00')) AT TIME ZONE 'Africa/Johannesburg';
    IF v_start <= p_now THEN CONTINUE; END IF;
    v_n := v_n + public.fl_service_no_tech_notify(r.id, 'now');
    IF v_start <= p_now + interval '24 hours' THEN
      v_n := v_n + public.fl_service_no_tech_notify(r.id, 'h24');
    ELSIF v_start <= p_now + interval '48 hours' THEN
      v_n := v_n + public.fl_service_no_tech_notify(r.id, 'h48');
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.fl_service_no_tech_notify(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_service_no_tech_mark_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_service_no_tech_tick(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_service_no_tech_tick(timestamptz) TO service_role;

COMMENT ON FUNCTION public.fl_service_no_tech_tick(timestamptz) IS
  'In-app only. One notice per visit, level and person: now, 48h before, 24h before. Stops once a technician is on the visit.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'service-no-tech-reminder') THEN
      PERFORM cron.unschedule('service-no-tech-reminder');
    END IF;
    PERFORM cron.schedule(
      'service-no-tech-reminder',
      '*/15 * * * *',
      'SELECT public.fl_service_no_tech_tick()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'service-no-tech cron not scheduled: %', SQLERRM;
END $$;
