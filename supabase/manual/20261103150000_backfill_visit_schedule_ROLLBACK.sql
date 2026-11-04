-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Moved out of supabase/migrations on 4 Nov 2026: run by hand only, after Johan approves.
-- Restores admin_backfill_visit as in 20261030180000_admin_backfill.sql (md5 body 69bc499a...). Schedule rows already created stay; delete by notes like '%(added by admin)' if needed.
CREATE OR REPLACE FUNCTION public.admin_backfill_visit(p_job uuid, p_tech uuid, p_date date, p_arrive time, p_leave time,
  p_completed boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; v_in timestamptz; v_out timestamptz; v_hours numeric; v_entry uuid; v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._backfill_ctx(p_job, p_tech);
  IF p_date IS NULL OR p_arrive IS NULL THEN RAISE EXCEPTION 'Date and arrival time are required' USING ERRCODE='22023'; END IF;
  v_in := (p_date + p_arrive) AT TIME ZONE 'Africa/Johannesburg';
  v_out := CASE WHEN p_leave IS NOT NULL THEN (p_date + p_leave) AT TIME ZONE 'Africa/Johannesburg' END;
  IF v_out IS NOT NULL AND v_out <= v_in THEN RAISE EXCEPTION 'Leave time must be after arrival' USING ERRCODE='22023'; END IF;
  IF v_in > now() THEN RAISE EXCEPTION 'That time is in the future' USING ERRCODE='22023'; END IF;
  v_hours := CASE WHEN v_out IS NOT NULL THEN round((extract(epoch FROM v_out - v_in)/3600.0)::numeric, 2) END;
  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  INSERT INTO public.job_time_entries(lead_id, agent_id, job_id, work_date, start_time, end_time, checked_in_at, checked_out_at,
      hours_worked, hours_auto, is_billable, notes, hours_edit_note, on_behalf_of, occurred_at, entered_by, entered_at)
    VALUES (c.o_lead, p_tech, p_job, p_date, p_arrive, p_leave, v_in, v_out, v_hours, v_hours, true, p_note,
      'Added by admin on behalf of tech', p_tech, v_in, auth.uid(), now())
    RETURNING id INTO v_entry;
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
