-- Fix: sync_assignment_to_schedule touched leads.updated_at (column does not exist -> 42703 on every lead-linked assignment).
-- Point it at leads.last_activity_at instead. Only that one line changes.
CREATE OR REPLACE FUNCTION public.sync_assignment_to_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_dur interval;
  v_end timestamptz;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF v_job.id IS NULL OR v_job.scheduled_for IS NULL OR v_job.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_dur := COALESCE(v_job.estimated_duration, interval '2 hours');
  v_end := v_job.scheduled_for + v_dur;

  -- Also mirror onto leads.assigned_agent_id so Map/legacy dispatch highlight it
  UPDATE public.leads
     SET assigned_agent_id = NEW.profile_id,
         last_activity_at = now()
   WHERE id = v_job.lead_id
     AND (assigned_agent_id IS NULL OR assigned_agent_id <> NEW.profile_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.job_schedules
     WHERE lead_id = v_job.lead_id AND agent_id = NEW.profile_id
  ) THEN
    INSERT INTO public.job_schedules (lead_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (
      v_job.lead_id, NEW.profile_id,
      (v_job.scheduled_for AT TIME ZONE 'UTC')::date,
      (v_job.scheduled_for AT TIME ZONE 'UTC')::time,
      (v_end AT TIME ZONE 'UTC')::time,
      v_job.description
    );
  END IF;

  RETURN NEW;
END;
$function$;