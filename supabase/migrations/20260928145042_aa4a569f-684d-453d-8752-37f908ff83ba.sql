-- Release D3: staff may log job status reverts for their own company (additive, mirrors the quote policy).
CREATE POLICY "Company staff log job changes"
ON public.status_change_log
FOR INSERT
TO authenticated
WITH CHECK (
  entity_type = 'job'
  AND changed_by = auth.uid()
  AND company_id IS NOT NULL
  AND company_id = public.get_user_company_id(auth.uid())
  AND NOT (public.has_role(auth.uid(), 'field_agent') AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dispatcher')))
);