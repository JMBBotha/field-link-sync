-- Rollback for 2026-10-13_v7_guards.sql (restores the exact pre-change definitions read 13 Oct 07:20).
CREATE OR REPLACE FUNCTION public.tech_can_see_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.status = 'pending' AND l.assigned_agent_id IS NULL
               AND (l.company_id IS NULL OR l.company_id = public.get_user_company_id(_uid)
                    OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=l.company_id))) /*p4*/
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid);
$function$;
DROP POLICY IF EXISTS rh_tech_scope ON public.leads;
CREATE POLICY rh_tech_scope ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (NOT (SELECT public.is_field_tech_only(auth.uid())))
  OR (assigned_agent_id = auth.uid())
  OR ((status = 'pending') AND (assigned_agent_id IS NULL))
  OR public.tech_can_see_lead(auth.uid(), id));
DROP FUNCTION IF EXISTS public.lead_is_callout(text, text);
DROP FUNCTION IF EXISTS public.is_platform_owner();
