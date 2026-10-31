-- Sales logins linked to an admin account can work on that admin's quote lines
-- (they could already see the quote and its areas, but not its items -> R0,00 header).
CREATE POLICY "Linked rep reads admin quote items" ON public.quote_items FOR SELECT TO authenticated
USING (public.my_linked_admin() IS NOT NULL AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
  AND q.company_id = public.caller_company_id()
  AND public.my_linked_admin() IN (q.sales_engineer_id, q.owner_id, q.created_by)));
CREATE POLICY "Linked rep writes admin quote items" ON public.quote_items FOR ALL TO authenticated
USING (public.my_linked_admin() IS NOT NULL AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
  AND q.company_id = public.caller_company_id()
  AND public.my_linked_admin() IN (q.sales_engineer_id, q.owner_id, q.created_by)))
WITH CHECK (public.my_linked_admin() IS NOT NULL AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
  AND q.company_id = public.caller_company_id()
  AND public.my_linked_admin() IN (q.sales_engineer_id, q.owner_id, q.created_by)));
