ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS started_at timestamptz, ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_job_status_times()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'in_progress' THEN
      NEW.started_at := COALESCE(NEW.started_at, now());
    ELSIF NEW.status = 'completed' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
      NEW.started_at := COALESCE(NEW.started_at, now());
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'in_progress' THEN
    NEW.started_at := COALESCE(NEW.started_at, OLD.started_at, now());
  ELSIF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.started_at := COALESCE(NEW.started_at, OLD.started_at, now());
  END IF;
  IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  IF NEW.status IN ('scheduled','dispatched','pending') THEN
    NEW.started_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_job_status_times ON public.jobs;
CREATE TRIGGER trg_set_job_status_times BEFORE INSERT OR UPDATE OF status ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_job_status_times();