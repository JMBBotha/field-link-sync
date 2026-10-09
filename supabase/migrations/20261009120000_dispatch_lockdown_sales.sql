-- ALREADY APPLIED to prod via SQL on 2026-10-09 (idempotent). Rollback: /workspace/dispatch-lockdown-2026-10-09/rollback.sql
-- Dispatch lockdown for salespeople (dispatcher + dispatch_role='sales'), 2026-10-09.
-- Reps may only create/update schedules and jobs for their OWN leads/quotes (Accept & schedule keeps working),
-- only for themselves (no assigning/reassigning techs), and may never change a job's status (status will be automated).
CREATE OR REPLACE FUNCTION public.rep_owns_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT _lead IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND _uid IN (l.assigned_agent_id, l.created_by))
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = _lead AND _uid IN (q.sales_engineer_id, q.owner_id, q.created_by)));
$f$;
CREATE OR REPLACE FUNCTION public.rep_owns_job(_uid uuid, _job uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job AND (
    j.created_by = _uid OR public.rep_owns_lead(_uid, j.lead_id)
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = j.quote_id AND _uid IN (q.sales_engineer_id, q.owner_id, q.created_by))));
$f$;
-- definer helper (an RLS-checked quotes subquery inside a jobs policy recursed)
CREATE OR REPLACE FUNCTION public.rep_owns_quote(_uid uuid, _quote uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT _quote IS NOT NULL AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = _quote AND _uid IN (q.sales_engineer_id, q.owner_id, q.created_by)); $f$;
REVOKE ALL ON FUNCTION public.rep_owns_quote(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_owns_quote(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rep_owns_lead(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_owns_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_owns_lead(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_owns_job(uuid, uuid) TO authenticated;

-- jobs
DROP POLICY IF EXISTS dl_rep_jobs_insert ON public.jobs;
CREATE POLICY dl_rep_jobs_insert ON public.jobs AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_sales_rep(auth.uid()) OR public.rep_owns_lead(auth.uid(), lead_id) OR public.rep_owns_quote(auth.uid(), quote_id));
DROP POLICY IF EXISTS dl_rep_jobs_update ON public.jobs;
CREATE POLICY dl_rep_jobs_update ON public.jobs AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_sales_rep(auth.uid()) OR public.rep_owns_job(auth.uid(), id))
  WITH CHECK (NOT public.is_sales_rep(auth.uid()) OR public.rep_owns_job(auth.uid(), id));
DROP POLICY IF EXISTS dl_rep_jobs_delete ON public.jobs;
CREATE POLICY dl_rep_jobs_delete ON public.jobs AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_sales_rep(auth.uid()) OR created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.dl_block_rep_job_status()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())
     -- Accept & schedule on the rep's own not-yet-dispatched job may (re)set 'scheduled'
     AND NOT (NEW.status = 'scheduled' AND coalesce(OLD.status,'') IN ('', 'draft', 'new', 'pending', 'unassigned')) THEN
    RAISE EXCEPTION 'Salespeople can''t change job status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS dl_block_rep_job_status ON public.jobs;
CREATE TRIGGER dl_block_rep_job_status BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.dl_block_rep_job_status();

-- job_schedules: own lead/job AND only their own calendar row
DROP POLICY IF EXISTS dl_rep_sched_insert ON public.job_schedules;
CREATE POLICY dl_rep_sched_insert ON public.job_schedules AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_sales_rep(auth.uid()) OR (agent_id = auth.uid()
    AND (public.rep_owns_lead(auth.uid(), lead_id) OR public.rep_owns_job(auth.uid(), job_id))));
DROP POLICY IF EXISTS dl_rep_sched_update ON public.job_schedules;
CREATE POLICY dl_rep_sched_update ON public.job_schedules AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_sales_rep(auth.uid()) OR (agent_id = auth.uid()
    AND (public.rep_owns_lead(auth.uid(), lead_id) OR public.rep_owns_job(auth.uid(), job_id))))
  WITH CHECK (NOT public.is_sales_rep(auth.uid()) OR (agent_id = auth.uid()
    AND (public.rep_owns_lead(auth.uid(), lead_id) OR public.rep_owns_job(auth.uid(), job_id))));
DROP POLICY IF EXISTS dl_rep_sched_delete ON public.job_schedules;
CREATE POLICY dl_rep_sched_delete ON public.job_schedules AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_sales_rep(auth.uid()) OR (agent_id = auth.uid()
    AND (public.rep_owns_lead(auth.uid(), lead_id) OR public.rep_owns_job(auth.uid(), job_id))));

-- assignments: reps can only hold their own assignment on their own job (no assigning techs)
DROP POLICY IF EXISTS dl_rep_assign_insert ON public.assignments;
CREATE POLICY dl_rep_assign_insert ON public.assignments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_sales_rep(auth.uid()) OR (profile_id = auth.uid() AND public.rep_owns_job(auth.uid(), job_id)));
DROP POLICY IF EXISTS dl_rep_assign_update ON public.assignments;
CREATE POLICY dl_rep_assign_update ON public.assignments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_sales_rep(auth.uid()) OR (profile_id = auth.uid() AND public.rep_owns_job(auth.uid(), job_id)))
  WITH CHECK (NOT public.is_sales_rep(auth.uid()) OR (profile_id = auth.uid() AND public.rep_owns_job(auth.uid(), job_id)));
DROP POLICY IF EXISTS dl_rep_assign_delete ON public.assignments;
CREATE POLICY dl_rep_assign_delete ON public.assignments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_sales_rep(auth.uid()) OR (profile_id = auth.uid() AND public.rep_owns_job(auth.uid(), job_id)));
