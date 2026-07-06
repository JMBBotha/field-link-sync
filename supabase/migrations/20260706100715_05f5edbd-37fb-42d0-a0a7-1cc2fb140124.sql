
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_lead_id_fkey;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.job_expenses DROP CONSTRAINT IF EXISTS job_expenses_lead_id_fkey;
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.maintenance_schedules DROP CONSTRAINT IF EXISTS maintenance_schedules_lead_id_fkey;
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
