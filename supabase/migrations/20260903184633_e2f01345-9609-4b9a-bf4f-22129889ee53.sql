ALTER TABLE public.job_schedules
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE;

ALTER TABLE public.job_schedules
  ALTER COLUMN agent_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS job_schedules_job_id_idx ON public.job_schedules(job_id);