-- Release D2: staff may append quote change rows to their own company's status log (additive).
GRANT INSERT ON public.status_change_log TO authenticated;
CREATE POLICY "Company staff log quote changes"
ON public.status_change_log
FOR INSERT
TO authenticated
WITH CHECK (
  entity_type = 'quote'
  AND changed_by = auth.uid()
  AND company_id IS NOT NULL
  AND company_id = public.get_user_company_id(auth.uid())
  AND NOT (public.has_role(auth.uid(), 'field_agent') AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dispatcher')))
);