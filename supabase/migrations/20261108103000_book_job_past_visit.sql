-- Book a job: a past visit can name its kind, and Correct later edits that same row.
-- Quiet path stays admin-only (fl_is_company_admin via _backfill_ctx) and sets app.backfill
-- so client messages and rep alerts do not fire. No new sale, no call-out fee.
-- Preview only until Johan says to take it live.

-- A visit can be a combination (First fix + Piping, Repair + Service, …). One array on the same row, not a second record.
ALTER TABLE public.job_time_entries DROP CONSTRAINT IF EXISTS job_time_entries_visit_kind_check;
ALTER TABLE public.job_time_entries DROP COLUMN IF EXISTS visit_kind;
ALTER TABLE public.job_time_entries ADD COLUMN IF NOT EXISTS visit_kinds text[];
ALTER TABLE public.job_time_entries DROP CONSTRAINT IF EXISTS job_time_entries_visit_kinds_check;
ALTER TABLE public.job_time_entries ADD CONSTRAINT job_time_entries_visit_kinds_check
  CHECK (visit_kinds IS NULL OR visit_kinds <@ ARRAY['first_fix','piping','ac_installation','commission','warranty','repair','service']::text[]);

DROP FUNCTION IF EXISTS public.admin_backfill_visit(uuid, uuid, date, time, time, boolean, text);
DROP FUNCTION IF EXISTS public.admin_backfill_visit(uuid, uuid, date, time, time, boolean, text, text);
DROP FUNCTION IF EXISTS public.admin_correct_visit(uuid, uuid, date, time, time, boolean, text, text);

CREATE OR REPLACE FUNCTION public.admin_backfill_visit(p_job uuid, p_tech uuid, p_date date, p_arrive time, p_leave time,
  p_completed boolean DEFAULT false, p_note text DEFAULT NULL, p_visit_kinds text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; v_in timestamptz; v_out timestamptz; v_hours numeric; v_entry uuid; v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._backfill_ctx(p_job, p_tech);
  IF p_date IS NULL OR p_arrive IS NULL THEN RAISE EXCEPTION 'Date and arrival time are required' USING ERRCODE='22023'; END IF;
  IF p_visit_kinds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_visit_kinds) k WHERE k NOT IN ('first_fix','piping','ac_installation','commission','warranty','repair','service')) THEN
    RAISE EXCEPTION 'Unknown visit kind' USING ERRCODE='22023'; END IF;
  v_in := (p_date + p_arrive) AT TIME ZONE 'Africa/Johannesburg';
  v_out := CASE WHEN p_leave IS NOT NULL THEN (p_date + p_leave) AT TIME ZONE 'Africa/Johannesburg' END;
  IF v_out IS NOT NULL AND v_out <= v_in THEN RAISE EXCEPTION 'Leave time must be after arrival' USING ERRCODE='22023'; END IF;
  IF v_in > now() THEN RAISE EXCEPTION 'That time is in the future' USING ERRCODE='22023'; END IF;
  v_hours := CASE WHEN v_out IS NOT NULL THEN round((extract(epoch FROM v_out - v_in)/3600.0)::numeric, 2) END;
  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  INSERT INTO public.job_time_entries(lead_id, agent_id, job_id, work_date, start_time, end_time, checked_in_at, checked_out_at,
      hours_worked, hours_auto, is_billable, notes, hours_edit_note, on_behalf_of, occurred_at, entered_by, entered_at, visit_kinds)
    VALUES (c.o_lead, p_tech, p_job, p_date, p_arrive, p_leave, v_in, v_out, v_hours, v_hours, true, p_note,
      'Added by admin on behalf of tech', p_tech, v_in, auth.uid(), now(), NULLIF(p_visit_kinds, '{}'))
    RETURNING id INTO v_entry;
  IF c.o_lead IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.job_id = p_job AND s.scheduled_date = p_date AND s.agent_id IS NOT DISTINCT FROM p_tech) THEN
    INSERT INTO public.job_schedules(lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
      VALUES (c.o_lead, p_job, p_tech, p_date, p_arrive, COALESCE(p_leave, LEAST(p_arrive + interval '1 hour', time '23:59')),
        COALESCE(nullif(trim(p_note), ''), 'Past visit') || ' (added by admin)');
  END IF;
  INSERT INTO public.presence_visits(company_id, user_id, kind, job_id, visit_date, arrived_at, left_at, arrived_source, left_source,
      on_behalf_of, occurred_at, entered_by, entered_at)
    VALUES (c.o_company, p_tech, 'job', p_job, p_date, v_in, v_out, 'admin_backfill', CASE WHEN v_out IS NOT NULL THEN 'admin_backfill' END,
      p_tech, v_in, auth.uid(), now())
  ON CONFLICT (user_id, kind, (COALESCE(job_id, lead_id)), visit_date) DO UPDATE SET
      arrived_at = EXCLUDED.arrived_at, left_at = COALESCE(EXCLUDED.left_at, presence_visits.left_at),
      arrived_source = 'admin_backfill', left_source = COALESCE(EXCLUDED.left_source, presence_visits.left_source),
      on_behalf_of = EXCLUDED.on_behalf_of, occurred_at = EXCLUDED.occurred_at, updated_at = now();
  IF p_completed THEN
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job;
    IF v_job.status IS DISTINCT FROM 'completed' THEN
      UPDATE public.jobs SET status = 'completed', started_at = COALESCE(started_at, v_in), completed_at = COALESCE(v_out, v_in), updated_at = now()
       WHERE id = p_job;
    END IF;
  END IF;
  PERFORM set_config('app.job_days_writing', '', true);
  PERFORM set_config('app.backfill', '', true);
  RETURN jsonb_build_object('time_entry_id', v_entry, 'hours', v_hours, 'completed', p_completed);
END $$;

-- Correct later: update the same time-entry id. Does not insert a second visit.
CREATE OR REPLACE FUNCTION public.admin_correct_visit(p_entry uuid, p_tech uuid, p_date date, p_arrive time, p_leave time,
  p_completed boolean DEFAULT false, p_note text DEFAULT NULL, p_visit_kinds text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e public.job_time_entries%ROWTYPE; c record; v_in timestamptz; v_out timestamptz; v_hours numeric; v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.job_time_entries WHERE id = p_entry;
  IF e.id IS NULL OR e.job_id IS NULL THEN RAISE EXCEPTION 'Visit not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public._backfill_ctx(e.job_id, p_tech);
  IF p_date IS NULL OR p_arrive IS NULL THEN RAISE EXCEPTION 'Date and arrival time are required' USING ERRCODE='22023'; END IF;
  IF p_visit_kinds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_visit_kinds) k WHERE k NOT IN ('first_fix','piping','ac_installation','commission','warranty','repair','service')) THEN
    RAISE EXCEPTION 'Unknown visit kind' USING ERRCODE='22023'; END IF;
  v_in := (p_date + p_arrive) AT TIME ZONE 'Africa/Johannesburg';
  v_out := CASE WHEN p_leave IS NOT NULL THEN (p_date + p_leave) AT TIME ZONE 'Africa/Johannesburg' END;
  IF v_out IS NOT NULL AND v_out <= v_in THEN RAISE EXCEPTION 'Leave time must be after arrival' USING ERRCODE='22023'; END IF;
  IF v_in > now() THEN RAISE EXCEPTION 'That time is in the future' USING ERRCODE='22023'; END IF;
  v_hours := CASE WHEN v_out IS NOT NULL THEN round((extract(epoch FROM v_out - v_in)/3600.0)::numeric, 2) END;
  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  UPDATE public.job_time_entries SET
    agent_id = p_tech, work_date = p_date, start_time = p_arrive, end_time = p_leave,
    checked_in_at = v_in, checked_out_at = v_out, hours_worked = v_hours, hours_auto = v_hours,
    notes = p_note, visit_kinds = NULLIF(p_visit_kinds, '{}'), on_behalf_of = p_tech, occurred_at = v_in
  WHERE id = e.id;
  DELETE FROM public.presence_visits
   WHERE job_id = e.job_id AND user_id = e.agent_id AND visit_date = e.work_date AND arrived_source = 'admin_backfill';
  INSERT INTO public.presence_visits(company_id, user_id, kind, job_id, visit_date, arrived_at, left_at, arrived_source, left_source,
      on_behalf_of, occurred_at, entered_by, entered_at)
    VALUES (c.o_company, p_tech, 'job', e.job_id, p_date, v_in, v_out, 'admin_backfill', CASE WHEN v_out IS NOT NULL THEN 'admin_backfill' END,
      p_tech, v_in, auth.uid(), now())
  ON CONFLICT (user_id, kind, (COALESCE(job_id, lead_id)), visit_date) DO UPDATE SET
      arrived_at = EXCLUDED.arrived_at, left_at = COALESCE(EXCLUDED.left_at, presence_visits.left_at),
      arrived_source = 'admin_backfill', left_source = COALESCE(EXCLUDED.left_source, presence_visits.left_source),
      on_behalf_of = EXCLUDED.on_behalf_of, occurred_at = EXCLUDED.occurred_at, updated_at = now();
  UPDATE public.job_schedules SET agent_id = p_tech, scheduled_date = p_date, start_time = p_arrive,
      end_time = COALESCE(p_leave, end_time),
      notes = COALESCE(nullif(trim(p_note), ''), 'Past visit') || ' (added by admin)'
   WHERE job_id = e.job_id AND scheduled_date = e.work_date AND agent_id IS NOT DISTINCT FROM e.agent_id
     AND COALESCE(notes, '') LIKE '%(added by admin)%';
  IF p_completed THEN
    SELECT * INTO v_job FROM public.jobs WHERE id = e.job_id;
    IF v_job.status IS DISTINCT FROM 'completed' THEN
      UPDATE public.jobs SET status = 'completed', started_at = COALESCE(started_at, v_in), completed_at = COALESCE(v_out, v_in), updated_at = now()
       WHERE id = e.job_id;
    END IF;
  END IF;
  PERFORM set_config('app.job_days_writing', '', true);
  PERFORM set_config('app.backfill', '', true);
  RETURN jsonb_build_object('time_entry_id', e.id, 'hours', v_hours, 'completed', p_completed, 'same_record', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_backfill_list(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.jobs WHERE id = p_job;
  IF NOT public.fl_is_company_admin(auth.uid(), v_co) THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'visits', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'work_date', e.work_date, 'start', e.start_time, 'end', e.end_time,
        'hours', e.hours_worked, 'notes', e.notes, 'visit_kinds', e.visit_kinds, 'tech_id', e.agent_id, 'tech', pt.full_name, 'by', pb.full_name, 'entered_at', e.entered_at, 'on_behalf', e.on_behalf_of IS NOT NULL)
        ORDER BY e.work_date DESC, e.start_time DESC), '[]')
      FROM public.job_time_entries e LEFT JOIN public.profiles pt ON pt.id = e.agent_id LEFT JOIN public.profiles pb ON pb.id = e.entered_by
      WHERE e.job_id = p_job),
    'units', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'label', u.unit_label, 'position', u.position, 'brand', u.brand,
        'model', u.model, 'serial', u.serial_number, 'tech', pt.full_name, 'by', pb.full_name, 'entered_at', u.entered_at) ORDER BY u.created_at), '[]')
      FROM public.job_unit_details u LEFT JOIN public.profiles pt ON pt.id = u.on_behalf_of LEFT JOIN public.profiles pb ON pb.id = u.entered_by
      WHERE u.job_id = p_job),
    'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'item', m.item, 'qty', m.qty, 'drawn_qty', m.drawn_qty, 'note', m.draw_note,
        'tech', pt.full_name, 'by', pb.full_name, 'entered_at', m.entered_at) ORDER BY m.created_at), '[]')
      FROM public.job_materials_used m LEFT JOIN public.profiles pt ON pt.id = m.on_behalf_of LEFT JOIN public.profiles pb ON pb.id = m.entered_by
      WHERE m.job_id = p_job));
END $$;

REVOKE ALL ON FUNCTION public.admin_backfill_visit(uuid,uuid,date,time,time,boolean,text,text[]),
  public.admin_correct_visit(uuid,uuid,date,time,time,boolean,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_backfill_visit(uuid,uuid,date,time,time,boolean,text,text[]),
  public.admin_correct_visit(uuid,uuid,date,time,time,boolean,text,text[]) TO authenticated;
