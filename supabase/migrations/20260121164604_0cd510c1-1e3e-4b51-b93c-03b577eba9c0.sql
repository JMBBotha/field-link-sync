-- Create service_agreements table (enums already exist from partial migration)
CREATE TABLE IF NOT EXISTS public.service_agreements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  contract_type text NOT NULL DEFAULT 'annual_ac_maintenance',
  contract_type_custom text,
  frequency text NOT NULL DEFAULT 'annual',
  start_date date NOT NULL,
  end_date date NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  auto_generate_jobs boolean NOT NULL DEFAULT true,
  next_service_due date,
  last_service_date date,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Enable RLS
ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can view all agreements"
ON public.service_agreements
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Field agents can view agreements for their leads"
ON public.service_agreements
FOR SELECT
USING (
  has_role(auth.uid(), 'field_agent'::app_role) 
  AND EXISTS (
    SELECT 1 FROM public.leads 
    WHERE leads.customer_id = service_agreements.customer_id 
    AND leads.assigned_agent_id = auth.uid()
  )
);

CREATE POLICY "Admins can create agreements"
ON public.service_agreements
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update agreements"
ON public.service_agreements
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete agreements"
ON public.service_agreements
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add agreement_id to leads table
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS agreement_id uuid REFERENCES public.service_agreements(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS scheduled_date date;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agreements_customer ON public.service_agreements(customer_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON public.service_agreements(status);
CREATE INDEX IF NOT EXISTS idx_agreements_next_service ON public.service_agreements(next_service_due);
CREATE INDEX IF NOT EXISTS idx_leads_agreement ON public.leads(agreement_id);

-- Function to get agreements due for service
CREATE OR REPLACE FUNCTION public.get_agreements_due_for_service(days_ahead integer DEFAULT 7)
RETURNS TABLE (
  agreement_id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  customer_address text,
  customer_lat numeric,
  customer_lng numeric,
  equipment_id uuid,
  contract_type text,
  contract_type_custom text,
  next_service_due date,
  frequency text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    sa.id as agreement_id,
    sa.customer_id,
    c.name as customer_name,
    c.phone as customer_phone,
    c.address as customer_address,
    c.latitude as customer_lat,
    c.longitude as customer_lng,
    sa.equipment_id,
    sa.contract_type,
    sa.contract_type_custom,
    sa.next_service_due,
    sa.frequency
  FROM public.service_agreements sa
  JOIN public.customers c ON sa.customer_id = c.id
  WHERE sa.status = 'active'
    AND sa.auto_generate_jobs = true
    AND sa.next_service_due IS NOT NULL
    AND sa.next_service_due <= CURRENT_DATE + days_ahead
    AND sa.next_service_due >= CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM public.leads l 
      WHERE l.agreement_id = sa.id 
      AND l.scheduled_date = sa.next_service_due
    )
  ORDER BY sa.next_service_due ASC;
END;
$function$;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_agreements;