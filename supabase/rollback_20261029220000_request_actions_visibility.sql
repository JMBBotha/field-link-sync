CREATE OR REPLACE FUNCTION public._req_can_act(p_req uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.requests r WHERE r.id = p_req AND auth.uid() IS NOT NULL AND (
    public.fl_is_company_office(auth.uid(), r.company_id)
    OR (public.fl_in_company(auth.uid(), r.company_id) AND (r.assigned_to = auth.uid() OR r.created_by = auth.uid()))));
$function$;
