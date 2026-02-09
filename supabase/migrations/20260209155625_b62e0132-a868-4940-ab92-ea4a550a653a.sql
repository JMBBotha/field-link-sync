
-- Table to track parts/materials used on a job
CREATE TABLE public.job_used_parts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.supplier_products(id),
  product_code text NOT NULL,
  product_name text NOT NULL,
  unit_cost numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  line_total numeric GENERATED ALWAYS AS (unit_cost * quantity) STORED,
  added_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.job_used_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view parts for their jobs"
  ON public.job_used_parts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM leads WHERE leads.id = job_used_parts.lead_id AND (leads.assigned_agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)))
  );

CREATE POLICY "Agents can add parts to their jobs"
  ON public.job_used_parts FOR INSERT
  WITH CHECK (added_by = auth.uid());

CREATE POLICY "Agents can delete parts from their jobs"
  ON public.job_used_parts FOR DELETE
  USING (
    added_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE INDEX idx_job_used_parts_lead ON public.job_used_parts(lead_id);
