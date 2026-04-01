-- Create job_activity_log table
CREATE TABLE IF NOT EXISTS public.job_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_activity_log_job_id ON public.job_activity_log(job_id);
CREATE INDEX idx_job_activity_log_created_at ON public.job_activity_log(created_at);

ALTER TABLE public.job_activity_log ENABLE ROW LEVEL SECURITY;

-- Users can see logs for jobs in their company OR jobs assigned to them
CREATE POLICY "Users see activity for accessible jobs" ON public.job_activity_log
FOR SELECT TO authenticated
USING (
  job_id IN (
    SELECT id FROM public.jobs WHERE company_id = public.get_user_company_id(auth.uid())
  )
  OR
  job_id IN (
    SELECT job_id FROM public.assignments WHERE profile_id = auth.uid()
  )
);

-- Authenticated users can insert notes (action = 'note_added')
CREATE POLICY "Users can add notes to accessible jobs" ON public.job_activity_log
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    job_id IN (
      SELECT id FROM public.jobs WHERE company_id = public.get_user_company_id(auth.uid())
    )
    OR
    job_id IN (
      SELECT job_id FROM public.assignments WHERE profile_id = auth.uid()
    )
  )
);

-- Trigger: log job creation and status changes
CREATE OR REPLACE FUNCTION public.log_job_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.job_activity_log (job_id, user_id, action, details)
    VALUES (NEW.id, auth.uid(), 'created',
            jsonb_build_object('title', NEW.title, 'status', NEW.status, 'priority', NEW.priority));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.job_activity_log (job_id, user_id, action, details)
    VALUES (NEW.id, auth.uid(), 'status_changed',
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_job_activity ON public.jobs;
CREATE TRIGGER trg_log_job_activity
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.log_job_activity();

-- Trigger: log assignment creation and status changes
CREATE OR REPLACE FUNCTION public.log_assignment_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_name text;
BEGIN
  SELECT full_name INTO v_agent_name FROM public.profiles WHERE id = NEW.profile_id;
  v_agent_name := COALESCE(v_agent_name, 'Unknown');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.job_activity_log (job_id, user_id, action, details)
    VALUES (NEW.job_id, COALESCE(NEW.assigned_by, auth.uid()), 'assigned',
            jsonb_build_object('agent_name', v_agent_name, 'agent_id', NEW.profile_id, 'assignment_type', NEW.assignment_type));
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.job_activity_log (job_id, user_id, action, details)
    VALUES (NEW.job_id, NEW.profile_id, 'assignment_status_changed',
            jsonb_build_object('agent_name', v_agent_name, 'old_status', OLD.status, 'new_status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_assignment_activity ON public.assignments;
CREATE TRIGGER trg_log_assignment_activity
  AFTER INSERT OR UPDATE OF status ON public.assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.log_assignment_activity();