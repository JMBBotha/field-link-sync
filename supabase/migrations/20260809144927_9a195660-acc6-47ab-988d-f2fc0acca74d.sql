CREATE TABLE public.job_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  technician_id uuid NOT NULL,
  work_summary text,
  customer_name text,
  customer_email text,
  signature_data_url text,
  signed_at timestamptz,
  parts_total numeric NOT NULL DEFAULT 0,
  labour_minutes integer NOT NULL DEFAULT 0,
  photo_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX job_completions_lead_unique ON public.job_completions(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX job_completions_company_idx ON public.job_completions(company_id);
CREATE INDEX job_completions_tech_idx ON public.job_completions(technician_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_completions TO authenticated;
GRANT ALL ON public.job_completions TO service_role;

ALTER TABLE public.job_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_completions_select" ON public.job_completions
  FOR SELECT TO authenticated
  USING (
    technician_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'dispatcher')
    OR (company_id IS NOT NULL AND company_id = public.get_user_company_id(auth.uid()))
  );

CREATE POLICY "job_completions_insert" ON public.job_completions
  FOR INSERT TO authenticated
  WITH CHECK (
    technician_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'dispatcher')
  );

CREATE POLICY "job_completions_update" ON public.job_completions
  FOR UPDATE TO authenticated
  USING (
    technician_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'dispatcher')
  )
  WITH CHECK (
    technician_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'dispatcher')
  );

CREATE POLICY "job_completions_delete" ON public.job_completions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER job_completions_set_updated_at
  BEFORE UPDATE ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER job_completions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();