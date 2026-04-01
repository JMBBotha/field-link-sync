
CREATE POLICY "Assignees can view job customers" ON public.customers FOR SELECT TO authenticated USING (
  id IN (
    SELECT j.customer_id FROM public.jobs j
    JOIN public.assignments a ON a.job_id = j.id
    WHERE a.profile_id = auth.uid() AND j.customer_id IS NOT NULL
  )
);
