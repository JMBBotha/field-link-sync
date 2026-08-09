ALTER TABLE public.nl_audit_log
  ADD COLUMN IF NOT EXISTS access_granted boolean,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id uuid;

CREATE OR REPLACE FUNCTION public.is_ops_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','dispatcher','platform_super_admin','platform_ops')
  );
$$;

DROP POLICY IF EXISTS "Tenant users can view quotes" ON public.quotes;
CREATE POLICY "quotes_select_policy" ON public.quotes
FOR SELECT TO authenticated
USING (
  company_id = public.get_user_company_id(auth.uid())
  AND (
    public.is_ops_user(auth.uid())
    OR sales_engineer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.assignments a ON a.job_id = j.id
      WHERE j.quote_id = quotes.id AND a.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.quote_id = quotes.id AND j.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.offers o
      WHERE o.lead_id = quotes.lead_id
        AND o.staff_id = auth.uid()
        AND o.status = 'accepted'
    )
  )
);

DROP POLICY IF EXISTS "Tenant users can view invoices" ON public.invoices;
CREATE POLICY "invoices_select_policy" ON public.invoices
FOR SELECT TO authenticated
USING (
  company_id = public.get_user_company_id(auth.uid())
  AND (
    public.is_ops_user(auth.uid())
    OR agent_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.assignments a ON a.job_id = j.id
      WHERE (j.invoice_id = invoices.id OR j.quote_id = invoices.quote_id)
        AND a.profile_id = auth.uid()
    )
  )
);