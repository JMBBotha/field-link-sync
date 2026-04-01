
-- Allow assignees to UPDATE job status (needed for My Jobs accept/start/complete flow)
CREATE POLICY "assignee_can_update_job_status"
ON public.jobs
FOR UPDATE
TO authenticated
USING (
  id IN (SELECT job_id FROM public.assignments WHERE profile_id = auth.uid() AND status NOT IN ('rejected', 'completed'))
)
WITH CHECK (
  id IN (SELECT job_id FROM public.assignments WHERE profile_id = auth.uid() AND status NOT IN ('rejected', 'completed'))
);
