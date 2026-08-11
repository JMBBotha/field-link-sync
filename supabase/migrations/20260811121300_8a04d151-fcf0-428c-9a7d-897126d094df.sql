CREATE OR REPLACE FUNCTION public.notify_job_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_customer text;
  v_title text;
  v_body text;
BEGIN
  SELECT l.company_id, COALESCE(l.customer_name, 'Customer')
    INTO v_company, v_customer
  FROM public.leads l WHERE l.id = NEW.lead_id;

  IF TG_OP = 'INSERT' THEN
    v_title := 'Job Scheduled';
  ELSE
    IF NEW.scheduled_date IS NOT DISTINCT FROM OLD.scheduled_date
       AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
       AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id THEN
      RETURN NEW;
    END IF;
    v_title := 'Job Rescheduled';
  END IF;

  v_body := v_customer || ' - ' || to_char(NEW.scheduled_date, 'DD Mon YYYY')
            || ' at ' || to_char(NEW.start_time::time, 'HH24:MI')
            || COALESCE(' with ' || (SELECT p.full_name FROM public.profiles p WHERE p.id = NEW.agent_id), '');

  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  SELECT DISTINCT u.user_id, 'job_schedule', v_title, v_body, NEW.lead_id
  FROM (
    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('admin', 'dispatcher')
      AND (v_company IS NULL OR p.company_id = v_company)
    UNION
    SELECT NEW.agent_id
  ) u
  WHERE u.user_id IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notify_job_schedule ON public.job_schedules;
CREATE TRIGGER tr_notify_job_schedule
AFTER INSERT OR UPDATE ON public.job_schedules
FOR EACH ROW EXECUTE FUNCTION public.notify_job_schedule();