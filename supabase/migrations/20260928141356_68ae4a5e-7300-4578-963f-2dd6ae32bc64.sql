CREATE TABLE public.job_overruns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  actual_hours numeric CHECK (actual_hours IS NULL OR actual_hours >= 0),
  extra_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_overruns_quote_idx ON public.job_overruns(quote_id);
CREATE INDEX job_overruns_job_idx ON public.job_overruns(job_id);

GRANT SELECT, INSERT ON public.job_overruns TO authenticated;
GRANT ALL ON public.job_overruns TO service_role;
ALTER TABLE public.job_overruns ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_log_job_overrun(_uid uuid, _job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = _job_id AND a.profile_id = _uid AND coalesce(a.status,'') <> 'rejected')
      OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = _job_id AND j.company_id = public.get_user_company_id(_uid))
$$;
CREATE OR REPLACE FUNCTION public.can_view_company_overruns(_uid uuid, _job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM jobs j WHERE j.id = _job_id AND j.company_id = public.get_user_company_id(_uid))
     AND (public.has_role(_uid,'admin') OR public.has_role(_uid,'dispatcher'))
$$;
REVOKE EXECUTE ON FUNCTION public.can_log_job_overrun(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_company_overruns(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_log_job_overrun(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_company_overruns(uuid, uuid) TO authenticated;

CREATE POLICY "overruns insert by assigned tech or company staff" ON public.job_overruns FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_log_job_overrun(auth.uid(), job_id));
CREATE POLICY "overruns read own" ON public.job_overruns FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND public.can_log_job_overrun(auth.uid(), job_id));
CREATE POLICY "overruns read company admin office" ON public.job_overruns FOR SELECT TO authenticated
  USING (public.can_view_company_overruns(auth.uid(), job_id));