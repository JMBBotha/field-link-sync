-- Sales reps (dispatcher + dispatch_role sales) are not office staff. Matches _lead_office.
CREATE OR REPLACE FUNCTION public.fl_is_company_office(_uid uuid, _company uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND (
    public.p4_is_platform()
    OR (public.has_role(_uid,'admin'::app_role) AND public.get_user_company_id(_uid) = public.fl_master_company_id())
    OR (_company IS NOT NULL AND _company = public.get_user_company_id(_uid)
        AND NOT public.is_sales_rep(_uid)
        AND (public.has_role(_uid,'admin'::app_role) OR public.has_role(_uid,'dispatcher'::app_role)
             OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=_company AND cm.role='admin')))
  ) $function$;

CREATE OR REPLACE FUNCTION public._job_alert_office(_uid uuid, _company uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT public.is_sales_rep(_uid) AND EXISTS (SELECT 1 FROM profiles p JOIN user_roles r ON r.user_id = p.id
    WHERE p.id = _uid AND p.company_id = _company AND r.role IN ('admin','dispatcher'))
$function$;

-- Rep path: jobs on leads the rep owns or assigned (same rule as sales_my_jobs).
CREATE OR REPLACE FUNCTION public.fl_can_see_job(_uid uuid, _job uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=_job AND (
    EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id=j.id AND a.profile_id=_uid AND coalesce(a.status,'')<>'rejected')
    OR public.fl_is_company_office(_uid, j.company_id)
    OR (public.is_sales_rep(_uid) AND j.company_id = public.get_user_company_id(_uid) AND public.rep_follows_lead(_uid, j.lead_id)))) $function$;

-- Rep path: read-only alerts for own jobs (no resolve).
DROP POLICY IF EXISTS "Rep reads own job alerts" ON public.job_alerts;
CREATE POLICY "Rep reads own job alerts" ON public.job_alerts FOR SELECT TO authenticated
  USING (public.is_sales_rep(auth.uid()) AND company_id = public.get_user_company_id(auth.uid())
         AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_alerts.job_id AND public.rep_follows_lead(auth.uid(), j.lead_id)));
