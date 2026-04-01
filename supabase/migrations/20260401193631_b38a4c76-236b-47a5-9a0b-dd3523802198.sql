-- Add metadata column to existing notifications table
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Create assignment notification trigger function
CREATE OR REPLACE FUNCTION public.notify_assignment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_title text;
  v_notify_user_id uuid;
  v_type text;
  v_title text;
  v_body text;
BEGIN
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
          v_notify_user_id := NEW.assigned_by;
          v_type := 'assignment_accepted';
          v_title := 'Assignment Accepted';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' accepted: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      WHEN 'rejected' THEN
        IF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by;
          v_type := 'assignment_rejected';
          v_title := 'Assignment Rejected';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' rejected: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      WHEN 'in_progress' THEN
        IF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by;
          v_type := 'assignment_started';
          v_title := 'Job Started';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' started: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      WHEN 'completed' THEN
        IF NEW.assigned_by IS NOT NULL THEN
          v_notify_user_id := NEW.assigned_by;
          v_type := 'assignment_completed';
          v_title := 'Job Completed';
          SELECT full_name INTO v_body FROM public.profiles WHERE id = NEW.profile_id;
          v_body := COALESCE(v_body, 'An agent') || ' completed: ' || v_job_title;
          INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
          VALUES (v_notify_user_id, v_type, v_title, v_body, NEW.job_id,
                  jsonb_build_object('assignment_id', NEW.id, 'job_id', NEW.job_id, 'status', NEW.status));
        END IF;
      ELSE
        NULL;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_assignment_status ON public.assignments;
CREATE TRIGGER trg_notify_assignment_status
  AFTER INSERT OR UPDATE OF status ON public.assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_assignment_status_change();