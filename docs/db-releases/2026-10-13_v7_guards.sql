-- v7 dashboard server guards (Johan approved 13 Oct 07:12). Company 361bf031 = Massair CT (Pty) Ltd (platform owner).
-- 1) is_platform_owner(): Massair admin (or platform role). Backs RequirePlatformOwner on /admin/companies, /admin/audit,
--    /admin/import, /admin/reports/advanced and /client/:companyId/*.
CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL AND (
    public.p4_is_platform()
    OR (public.has_role(auth.uid(), 'admin'::app_role)
        AND public.get_user_company_id(auth.uid()) = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid))
$f$;
REVOKE ALL ON FUNCTION public.is_platform_owner() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated;

-- 2) Lead rule: techs never see the leads inbox. An unassigned pending lead is only visible to a tech-only user
--    as a JOB OFFER when it is a service/repair call-out (R680); sales/quote/install leads go to sales first.
CREATE OR REPLACE FUNCTION public.lead_is_callout(_intent text, _service_type text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN _intent = 'service' THEN true
    WHEN _intent = 'sales' THEN false
    ELSE COALESCE(_service_type, '') !~* '(sales|consult|quote|install)'
  END
$f$;

CREATE OR REPLACE FUNCTION public.tech_can_see_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.status = 'pending' AND l.assigned_agent_id IS NULL
               AND public.lead_is_callout(l.primary_intent::text, l.service_type)
               AND (l.company_id IS NULL OR l.company_id = public.get_user_company_id(_uid)
                    OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=l.company_id))) /*p4 v7*/
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid);
$function$;

DROP POLICY IF EXISTS rh_tech_scope ON public.leads;
CREATE POLICY rh_tech_scope ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (NOT (SELECT public.is_field_tech_only(auth.uid())))
  OR (assigned_agent_id = auth.uid())
  OR ((status = 'pending') AND (assigned_agent_id IS NULL) AND public.lead_is_callout(primary_intent::text, service_type))
  OR public.tech_can_see_lead(auth.uid(), id));
