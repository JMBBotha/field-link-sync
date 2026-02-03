-- Create table for lead change requests
CREATE TABLE public.lead_change_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  request_type TEXT NOT NULL, -- 'adjust_start_time', 'adjust_scheduled_date', 'adjust_completed_time', 'adjust_duration'
  current_value TEXT, -- JSON string of current value
  requested_value TEXT NOT NULL, -- JSON string of requested value
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_change_requests ENABLE ROW LEVEL SECURITY;

-- Agents can view their own requests
CREATE POLICY "Agents can view their own requests"
ON public.lead_change_requests
FOR SELECT
USING (requested_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- Agents can create requests for their assigned leads
CREATE POLICY "Agents can create change requests"
ON public.lead_change_requests
FOR INSERT
WITH CHECK (
  requested_by = auth.uid() AND 
  EXISTS (
    SELECT 1 FROM public.leads 
    WHERE leads.id = lead_id 
    AND leads.assigned_agent_id = auth.uid()
  )
);

-- Admins can update requests (approve/reject)
CREATE POLICY "Admins can update requests"
ON public.lead_change_requests
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete requests
CREATE POLICY "Admins can delete requests"
ON public.lead_change_requests
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add index for performance
CREATE INDEX idx_lead_change_requests_lead_id ON public.lead_change_requests(lead_id);
CREATE INDEX idx_lead_change_requests_status ON public.lead_change_requests(status);
CREATE INDEX idx_lead_change_requests_requested_by ON public.lead_change_requests(requested_by);