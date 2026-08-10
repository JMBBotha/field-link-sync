ALTER TABLE public.lead_change_requests ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE public.lead_change_requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'agent';
ALTER TABLE public.lead_change_requests ADD COLUMN IF NOT EXISTS customer_message text;

DROP POLICY IF EXISTS "Agents can view their own requests" ON public.lead_change_requests;
CREATE POLICY "Staff can view change requests"
ON public.lead_change_requests
FOR SELECT
TO authenticated
USING (
  requested_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'dispatcher'::app_role)
);

DROP POLICY IF EXISTS "Admins can update requests" ON public.lead_change_requests;
CREATE POLICY "Admins and dispatchers can update requests"
ON public.lead_change_requests
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'dispatcher'::app_role)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_change_requests TO authenticated;
GRANT ALL ON public.lead_change_requests TO service_role;