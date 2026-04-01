
-- Add job_type column to existing jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS job_type text DEFAULT 'service' CHECK (job_type IN ('installation', 'service', 'repair', 'survey', 'maintenance'));

-- Add job_type filter index
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON public.jobs(job_type);
