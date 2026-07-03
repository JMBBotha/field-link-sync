CREATE OR REPLACE FUNCTION public.user_is_assigned_to_job(_user_id uuid, _job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.profile_id = _user_id
      AND a.job_id = _job_id
  )
$$;

CREATE OR REPLACE FUNCTION public.user_can_update_assigned_job(_user_id uuid, _job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.profile_id = _user_id
      AND a.job_id = _job_id
      AND a.status <> ALL (ARRAY['rejected'::text, 'completed'::text])
  )
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_job_company(_user_id uuid, _job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.company_members cm ON cm.company_id = j.company_id
    WHERE j.id = _job_id
      AND cm.user_id = _user_id
  )
$$;

DROP POLICY IF EXISTS "Assignees can view their jobs" ON public.jobs;
DROP POLICY IF EXISTS "assigned_sees_job" ON public.jobs;
DROP POLICY IF EXISTS "assignee_can_update_job_status" ON public.jobs;
DROP POLICY IF EXISTS "company_sees_job_assignments" ON public.assignments;
DROP POLICY IF EXISTS "platform_ops_all_jobs" ON public.jobs;
DROP POLICY IF EXISTS "platform_ops_all_assignments" ON public.assignments;

CREATE POLICY "Assignees can view their jobs"
ON public.jobs
FOR SELECT
TO authenticated
USING (public.user_is_assigned_to_job(auth.uid(), id));

CREATE POLICY "assignee_can_update_job_status"
ON public.jobs
FOR UPDATE
TO authenticated
USING (public.user_can_update_assigned_job(auth.uid(), id))
WITH CHECK (public.user_can_update_assigned_job(auth.uid(), id));

CREATE POLICY "company_sees_job_assignments"
ON public.assignments
FOR ALL
TO authenticated
USING (public.user_can_access_job_company(auth.uid(), job_id))
WITH CHECK (public.user_can_access_job_company(auth.uid(), job_id));

CREATE POLICY "platform_ops_all_jobs"
ON public.jobs
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
);

CREATE POLICY "platform_ops_all_assignments"
ON public.assignments
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
);