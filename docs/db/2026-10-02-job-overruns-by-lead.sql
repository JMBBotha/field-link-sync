-- Release 2 (2 Oct 2026): tech "Actual on site" can be saved by LEAD (no jobs row needed).
-- Approved by Johan 11:07 SAST. Idempotent. No data changes.
ALTER TABLE public.job_overruns ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE;
ALTER TABLE public.job_overruns ALTER COLUMN job_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_overruns_job_or_lead') THEN
    ALTER TABLE public.job_overruns ADD CONSTRAINT job_overruns_job_or_lead CHECK (job_id IS NOT NULL OR lead_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS job_overruns_lead_idx ON public.job_overruns(lead_id);

-- Company that owns an overrun row (lead first, else job).
CREATE OR REPLACE FUNCTION public.overrun_company_id(_job_id uuid, _lead_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT l.company_id FROM public.leads l WHERE l.id = _lead_id),
                  (SELECT j.company_id FROM public.jobs j WHERE j.id = _job_id))
$$;

-- Who may log: same company only; a field tech only on their own lead/job.
CREATE OR REPLACE FUNCTION public.can_log_overrun(_uid uuid, _job_id uuid, _lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
    AND public.overrun_company_id(_job_id, _lead_id) IS NOT NULL
    AND public.overrun_company_id(_job_id, _lead_id) = public.get_user_company_id(_uid)
    AND (_job_id IS NULL OR _lead_id IS NULL OR EXISTS (
          SELECT 1 FROM public.jobs j JOIN public.leads l ON l.id = _lead_id
           WHERE j.id = _job_id AND j.company_id IS NOT DISTINCT FROM l.company_id))
    AND (NOT public.is_field_tech_only(_uid)
         OR (_lead_id IS NOT NULL AND public.tech_owns_lead(_uid, _lead_id))
         OR (_job_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.assignments a
                WHERE a.job_id = _job_id AND a.profile_id = _uid AND coalesce(a.status, '') <> 'rejected')))
$$;

-- Who may read all company overruns: admin/dispatcher of the same company (same as before, now lead-aware).
CREATE OR REPLACE FUNCTION public.can_view_overrun(_uid uuid, _job_id uuid, _lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
    AND public.overrun_company_id(_job_id, _lead_id) = public.get_user_company_id(_uid)
    AND (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'dispatcher'))
$$;

REVOKE EXECUTE ON FUNCTION public.overrun_company_id(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_log_overrun(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_overrun(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.overrun_company_id(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_log_overrun(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_overrun(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "overruns insert by assigned tech or company staff" ON public.job_overruns;
DROP POLICY IF EXISTS "overruns read own" ON public.job_overruns;
DROP POLICY IF EXISTS "overruns read company admin office" ON public.job_overruns;
DROP POLICY IF EXISTS "overruns insert own company" ON public.job_overruns;
DROP POLICY IF EXISTS "overruns read company office" ON public.job_overruns;

CREATE POLICY "overruns insert own company" ON public.job_overruns FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_log_overrun(auth.uid(), job_id, lead_id));
CREATE POLICY "overruns read own" ON public.job_overruns FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.can_log_overrun(auth.uid(), job_id, lead_id));
CREATE POLICY "overruns read company office" ON public.job_overruns FOR SELECT TO authenticated
  USING (public.can_view_overrun(auth.uid(), job_id, lead_id));

-- Fill lead_id / quote_id server-side (techs often cannot read quotes or jobs).
CREATE OR REPLACE FUNCTION public.job_overruns_fill_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_id IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT j.lead_id INTO NEW.lead_id FROM public.jobs j WHERE j.id = NEW.job_id;
  END IF;
  IF NEW.quote_id IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT j.quote_id INTO NEW.quote_id FROM public.jobs j WHERE j.id = NEW.job_id;
  END IF;
  IF NEW.quote_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT q.id INTO NEW.quote_id FROM public.quotes q
     WHERE q.lead_id = NEW.lead_id AND q.status <> 'declined' AND q.superseded_by IS NULL
     ORDER BY (q.status = 'accepted') DESC, q.created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.job_overruns_fill_links() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tr_job_overruns_fill_links ON public.job_overruns;
CREATE TRIGGER tr_job_overruns_fill_links BEFORE INSERT ON public.job_overruns
  FOR EACH ROW EXECUTE FUNCTION public.job_overruns_fill_links();
