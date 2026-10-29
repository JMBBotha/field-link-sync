-- Request actions (mark contacted, set type, done) use the SAME visibility as requests_inbox,
-- incl. owner-rep follows. Masked (POPIA) rows stay read-only: you can only act on rows you can see unmasked.
CREATE OR REPLACE FUNCTION public._req_can_act(p_req uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.requests r WHERE r.id = p_req AND auth.uid() IS NOT NULL
    AND public.fl_in_company(auth.uid(), r.company_id)
    AND (public.fl_is_company_office(auth.uid(), r.company_id)
         OR r.assigned_to = auth.uid() OR r.created_by = auth.uid()
         OR (r.lead_id IS NOT NULL AND public.rep_follows_lead(auth.uid(), r.lead_id))
         OR (public.is_sales_rep(auth.uid()) AND public.fl_rep_owns_customer(auth.uid(), r.customer_id, r.company_id))));
$function$;
