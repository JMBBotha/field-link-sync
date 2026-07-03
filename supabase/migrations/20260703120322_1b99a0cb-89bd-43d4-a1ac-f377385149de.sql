
-- Mirror jobs into leads so Map/Schedule/legacy views see them.
-- Also create job_schedules when an assignment is added to a scheduled job.

CREATE OR REPLACE FUNCTION public.mirror_job_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_customer record;
  v_name text;
  v_phone text;
  v_address text;
  v_lat numeric;
  v_lng numeric;
BEGIN
  -- If job already tied to a lead, sync a few fields and exit
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET customer_id = COALESCE(customer_id, NEW.customer_id),
           status = CASE
             WHEN NEW.status = 'completed' THEN 'completed'
             WHEN NEW.status = 'in_progress' THEN 'in_progress'
             WHEN NEW.status = 'cancelled' THEN 'cancelled'
             ELSE status
           END,
           updated_at = now()
     WHERE id = NEW.lead_id;
    RETURN NEW;
  END IF;

  -- Pull customer info if available
  IF NEW.customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers WHERE id = NEW.customer_id;
  END IF;

  v_name    := COALESCE(v_customer.name, NEW.title, 'Job');
  v_phone   := COALESCE(v_customer.phone, 'N/A');
  v_address := COALESCE(NEW.address, v_customer.address, v_customer.primary_address_line1, 'N/A');
  v_lat     := COALESCE(NEW.lat, v_customer.latitude, 0);
  v_lng     := COALESCE(NEW.lng, v_customer.longitude, 0);

  INSERT INTO public.leads (
    customer_name, customer_phone, customer_address,
    latitude, longitude, service_type, status, priority,
    notes, customer_id, company_id, created_at
  ) VALUES (
    v_name, v_phone, v_address,
    v_lat, v_lng,
    COALESCE(NEW.job_type, 'service'),
    CASE NEW.status
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'completed'   THEN 'completed'
      WHEN 'cancelled'   THEN 'cancelled'
      ELSE 'pending'
    END,
    COALESCE(NEW.priority, 'normal'),
    NEW.description,
    NEW.customer_id, NEW.company_id, now()
  )
  RETURNING id INTO v_lead_id;

  NEW.lead_id := v_lead_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_job_to_lead ON public.jobs;
CREATE TRIGGER trg_mirror_job_to_lead
BEFORE INSERT OR UPDATE OF status, customer_id ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.mirror_job_to_lead();


-- When an assignment is created for a job with scheduled_for, create a job_schedules row
CREATE OR REPLACE FUNCTION public.sync_assignment_to_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
         updated_at = now()
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
$$;

DROP TRIGGER IF EXISTS trg_sync_assignment_to_schedule ON public.assignments;
CREATE TRIGGER trg_sync_assignment_to_schedule
AFTER INSERT OR UPDATE OF profile_id ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_assignment_to_schedule();


-- Enable realtime on jobs so all views auto-refresh
ALTER TABLE public.jobs REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
