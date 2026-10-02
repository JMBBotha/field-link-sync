-- Rollback Release 2 DB change. Restores the original job_overruns policies (job-keyed).
-- Rows are never deleted. Lead-only rows (job_id NULL) simply become invisible again.
DROP POLICY IF EXISTS "overruns insert own company" ON public.job_overruns;
DROP POLICY IF EXISTS "overruns read own" ON public.job_overruns;
DROP POLICY IF EXISTS "overruns read company office" ON public.job_overruns;
CREATE POLICY "overruns insert by assigned tech or company staff" ON public.job_overruns FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_log_job_overrun(auth.uid(), job_id));
CREATE POLICY "overruns read own" ON public.job_overruns FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.can_log_job_overrun(auth.uid(), job_id));
CREATE POLICY "overruns read company admin office" ON public.job_overruns FOR SELECT TO authenticated
  USING (public.can_view_company_overruns(auth.uid(), job_id));
DROP TRIGGER IF EXISTS tr_job_overruns_fill_links ON public.job_overruns;
DROP FUNCTION IF EXISTS public.job_overruns_fill_links();
DROP FUNCTION IF EXISTS public.can_log_overrun(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.can_view_overrun(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.overrun_company_id(uuid, uuid);
-- Schema: only reverted when no row depends on it (never deletes data).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_overruns WHERE job_id IS NULL OR lead_id IS NOT NULL) THEN
    ALTER TABLE public.job_overruns DROP CONSTRAINT IF EXISTS job_overruns_job_or_lead;
    DROP INDEX IF EXISTS public.job_overruns_lead_idx;
    ALTER TABLE public.job_overruns ALTER COLUMN job_id SET NOT NULL;
    ALTER TABLE public.job_overruns DROP COLUMN IF EXISTS lead_id;
  ELSE
    RAISE NOTICE 'job_overruns has lead-based rows; schema columns kept (policies rolled back).';
  END IF;
END $$;
