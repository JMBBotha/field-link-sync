-- v8 Schedule: real unschedule + cancel from the calendar drop zones (in-app notices only; no client messages).
DROP FUNCTION IF EXISTS public.fl_unschedule_booking(uuid, uuid, uuid);
-- p_reason given = 'Needs rescheduling' (stays active, sits in that tray + attention alerts until rebooked).
CREATE OR REPLACE FUNCTION public.fl_unschedule_booking(p_lead_id uuid, p_job_id uuid DEFAULT NULL, p_schedule_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_agent uuid; v_old text; v_name text; v_job uuid := p_job_id;
BEGIN
  SELECT l.company_id, l.assigned_agent_id, COALESCE(l.customer_name,'Customer'),
         COALESCE(l.scheduled_date::text,'') || ' ' || COALESCE(to_char(l.scheduled_time,'HH24:MI'),'')
    INTO v_company, v_agent, v_name, v_old FROM public.leads l WHERE l.id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF p_schedule_id IS NOT NULL THEN
    SELECT COALESCE(v_job, s.job_id), COALESCE(s.agent_id, v_agent), s.scheduled_date::text || ' ' || to_char(s.start_time,'HH24:MI')
      INTO v_job, v_agent, v_old FROM public.job_schedules s WHERE s.id = p_schedule_id AND s.lead_id = p_lead_id;
  END IF;
  IF NOT (public.rh_ops_ok(v_company) OR v_agent = auth.uid()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF v_job IS NOT NULL THEN
    -- Order matters: clear scheduled_for first so sync_assignment_to_schedule doesn't recreate the slot.
    UPDATE public.jobs SET scheduled_for = NULL, updated_at = now() WHERE id = v_job AND company_id = v_company;
    UPDATE public.assignments SET status = 'rejected' WHERE job_id = v_job AND status IN ('proposed','accepted');
    UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = v_job AND status = 'pending';
    UPDATE public.leads SET assigned_agent_id = NULL, scheduled_date = NULL, scheduled_time = NULL WHERE id = p_lead_id AND status NOT IN ('completed','cancelled');
    DELETE FROM public.job_schedules WHERE job_id = v_job;  -- the calendar slot only; the job record stays
  ELSE
    IF p_schedule_id IS NOT NULL THEN DELETE FROM public.job_schedules WHERE id = p_schedule_id; END IF;
    UPDATE public.leads SET assigned_agent_id = NULL, scheduled_date = NULL, scheduled_time = NULL,
           status = CASE WHEN status = 'accepted' THEN 'pending' ELSE status END
     WHERE id = p_lead_id;
  END IF;
  INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
  VALUES (CASE WHEN v_job IS NULL THEN 'lead' ELSE 'job' END, COALESCE(v_job, p_lead_id),
          CASE WHEN p_reason IS NULL THEN 'schedule' ELSE 'needs_reschedule' END, trim(v_old),
          COALESCE(left(trim(p_reason), 300), 'unscheduled'), auth.uid(), v_company);
  IF v_agent IS NOT NULL AND v_agent IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (v_agent, 'job_unscheduled', 'Booking removed from your schedule', v_name || ' (' || trim(v_old) || ') was ' || CASE WHEN p_reason IS NULL THEN 'unscheduled by the office.' ELSE 'moved to Needs rescheduling: ' || left(trim(p_reason), 200) END, p_lead_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'notified', v_agent);
END $$;

CREATE OR REPLACE FUNCTION public.fl_cancel_booking(p_lead_id uuid, p_reason text, p_job_id uuid DEFAULT NULL, p_schedule_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_agent uuid; v_name text; v_job uuid := p_job_id; v_old text;
BEGIN
  IF length(trim(COALESCE(p_reason,''))) < 3 THEN RAISE EXCEPTION 'reason required'; END IF;
  SELECT l.company_id, l.assigned_agent_id, COALESCE(l.customer_name,'Customer'), l.status
    INTO v_company, v_agent, v_name, v_old FROM public.leads l WHERE l.id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF p_schedule_id IS NOT NULL THEN
    SELECT COALESCE(v_job, s.job_id), COALESCE(s.agent_id, v_agent) INTO v_job, v_agent FROM public.job_schedules s WHERE s.id = p_schedule_id AND s.lead_id = p_lead_id;
  END IF;
  IF NOT (public.rh_ops_ok(v_company) OR v_agent = auth.uid()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF v_job IS NOT NULL THEN
    SELECT status INTO v_old FROM public.jobs WHERE id = v_job AND company_id = v_company;
    UPDATE public.jobs SET status = 'cancelled', updated_at = now() WHERE id = v_job AND company_id = v_company;
    UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = v_job AND status = 'pending';
  ELSE
    UPDATE public.leads SET status = 'cancelled' WHERE id = p_lead_id;
    UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE lead_id = p_lead_id AND status = 'pending';
  END IF;
  INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
  VALUES (CASE WHEN v_job IS NULL THEN 'lead' ELSE 'job' END, COALESCE(v_job, p_lead_id), 'cancel_reason', v_old, left(trim(p_reason), 300), auth.uid(), v_company);
  IF v_agent IS NOT NULL AND v_agent IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (v_agent, 'job_cancelled', 'Booking cancelled', v_name || ' was cancelled: ' || left(trim(p_reason), 200), p_lead_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'notified', v_agent);
END $$;

-- Reopen a cancelled booking (never deleted). Job: back to 'scheduled' (its slot reappears; drag to a new day/person). Lead: back to pending + unassigned tray.
CREATE OR REPLACE FUNCTION public.fl_reopen_booking(p_lead_id uuid, p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_agent uuid; v_status text;
BEGIN
  SELECT l.company_id, l.assigned_agent_id, l.status INTO v_company, v_agent, v_status FROM public.leads l WHERE l.id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF NOT public.rh_ops_ok(v_company) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF p_job_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.jobs WHERE id = p_job_id AND company_id = v_company;
    IF v_status IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'not cancelled'; END IF;
    UPDATE public.jobs SET status = 'scheduled', updated_at = now() WHERE id = p_job_id;
    UPDATE public.leads SET status = 'converted' WHERE id = p_lead_id AND status = 'cancelled';
  ELSE
    IF v_status IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'not cancelled'; END IF;
    UPDATE public.leads SET status = 'pending', assigned_agent_id = NULL, scheduled_date = NULL, scheduled_time = NULL WHERE id = p_lead_id;
  END IF;
  INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
  VALUES (CASE WHEN p_job_id IS NULL THEN 'lead' ELSE 'job' END, COALESCE(p_job_id, p_lead_id), 'status', 'cancelled', 'reopened', auth.uid(), v_company);
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.fl_unschedule_booking(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fl_cancel_booking(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fl_unschedule_booking(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fl_cancel_booking(uuid, text, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fl_reopen_booking(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fl_reopen_booking(uuid, uuid) TO authenticated;
