
CREATE POLICY "Users can view own assignments" ON public.assignments FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE POLICY "Assignees can view their jobs" ON public.jobs FOR SELECT TO authenticated USING (id IN (SELECT job_id FROM public.assignments WHERE profile_id = auth.uid()));
