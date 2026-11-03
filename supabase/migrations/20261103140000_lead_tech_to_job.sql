-- When a lead's technician is set or changed and the lead already has an open job with no tech,
-- copy the tech onto the job (assignments), link the lead's unlinked calendar slots to the job and
-- fill jobs.scheduled_for from the lead booking. The lead dispatch already notified the tech, so the
-- copy is quiet: no 'New Job Assignment' and no 'Job Scheduled' duplicate.
-- Cause (3 Nov 2026): House 88/32 jobs were created before the lead was dispatched, so the job showed 'No tech yet'.

-- 1) Assignment notice: skip while the lead->job copy is writing.
CREATE OR REPLACE FUNCTION public.notify_assignment_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_job_title text;
  v_notify_user_id uuid;
  v_type text;
  v_title text;
  v_body text;
BEGIN
  -- Lead dispatch already told the tech; the copy onto the job must not repeat it.
  IF TG_OP = 'INSERT' AND current_setting('app.lead_tech_to_job', true) = 'on' THEN RETURN NEW; END IF;

  SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
  v_job_title := COALESCE(v_job_title, 'Untitled Job');

  IF TG_OP = 'INSERT' THEN
    v_notify_user_id := NEW.profile_id;
    v_type := 'assignment_created';
    v_title := 'New Job Assignment';
    v_body := 'You have been assigned to: ' || v_job_title;
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
            jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    CASE NEW.status
      WHEN 'accepted' THEN
        IF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by; v_type := 'assignment_accepted'; v_title := 'Assignment Accepted';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' accepted: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      WHEN 'rejected' THEN
        IF current_setting('app.office_unschedule', true) = 'on' THEN
          NULL;
        ELSIF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by; v_type := 'assignment_rejected'; v_title := 'Assignment Rejected';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' rejected: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      WHEN 'in_progress' THEN
        IF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by; v_type := 'assignment_started'; v_title := 'Job Started';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' started: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      WHEN 'completed' THEN
        IF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by; v_type := 'assignment_completed'; v_title := 'Job Completed';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' completed: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      ELSE NULL;
    END CASE;
  END IF;
  RETURN NEW;
END;
$fn$;

-- 2) Copy the lead's tech, time and calendar slots onto its open job(s) that have no tech.
CREATE OR REPLACE FUNCTION public.copy_lead_tech_to_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE j record; v_prev_copy text; v_prev_days text;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN RETURN NEW; END IF;
  IF current_setting('app.lead_tech_to_job', true) = 'on' THEN RETURN NEW; END IF;

  v_prev_copy := current_setting('app.lead_tech_to_job', true);
  v_prev_days := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.lead_tech_to_job', 'on', true);
  PERFORM set_config('app.job_days_writing', '1', true);  -- quiets Job Scheduled/Rescheduled and schedule resync

  FOR j IN
    SELECT jb.* FROM public.jobs jb
     WHERE jb.lead_id = NEW.id
       AND lower(COALESCE(jb.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'invoiced')
       AND NOT EXISTS (SELECT 1 FROM public.assignments a
                        WHERE a.job_id = jb.id AND COALESCE(a.status, '') NOT IN ('rejected', 'cancelled'))
  LOOP
    UPDATE public.job_schedules SET job_id = j.id, updated_at = now()
     WHERE lead_id = NEW.id AND job_id IS NULL;
    INSERT INTO public.assignments (job_id, profile_id, assigned_by, assignment_type, status, notes)
    VALUES (j.id, NEW.assigned_agent_id, auth.uid(), 'internal', 'accepted', 'Copied from lead dispatch');
    IF j.scheduled_for IS NULL AND NEW.scheduled_date IS NOT NULL THEN
      UPDATE public.jobs
         SET scheduled_for = ((NEW.scheduled_date + COALESCE(NEW.scheduled_time, time '08:00')) AT TIME ZONE 'Africa/Johannesburg')
       WHERE id = j.id;
    END IF;
  END LOOP;

  PERFORM set_config('app.job_days_writing', COALESCE(v_prev_days, ''), true);
  PERFORM set_config('app.lead_tech_to_job', COALESCE(v_prev_copy, ''), true);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_zz_lead_tech_to_job ON public.leads;
CREATE TRIGGER trg_zz_lead_tech_to_job
  AFTER UPDATE OF assigned_agent_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.copy_lead_tech_to_job();
