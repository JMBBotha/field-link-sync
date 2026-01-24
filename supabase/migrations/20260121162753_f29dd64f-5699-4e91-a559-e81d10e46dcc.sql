-- Create customers table
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text,
  phone text NOT NULL,
  address text,
  latitude numeric,
  longitude numeric,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

-- Enable RLS on customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- RLS policies for customers
CREATE POLICY "Authenticated users can view customers"
ON public.customers FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can create customers"
ON public.customers FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role));

CREATE POLICY "Admins can update customers"
ON public.customers FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role));

CREATE POLICY "Admins can delete customers"
ON public.customers FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create equipment types enum
CREATE TYPE public.equipment_type AS ENUM ('ac', 'heater', 'vent', 'heat_pump', 'furnace', 'other');

-- Create equipment table
CREATE TABLE public.equipment (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type equipment_type NOT NULL DEFAULT 'ac',
  brand text,
  model text,
  serial_number text,
  install_date date,
  warranty_expiry date,
  location text,
  notes text,
  last_service_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on equipment
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

-- RLS policies for equipment
CREATE POLICY "Authenticated users can view equipment"
ON public.equipment FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Agents can create equipment"
ON public.equipment FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role));

CREATE POLICY "Agents can update equipment"
ON public.equipment FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role));

CREATE POLICY "Admins can delete equipment"
ON public.equipment FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add customer_id reference to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);

-- Add equipment_id reference to leads (for linking jobs to specific equipment)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment(id);

-- Add equipment_id reference to invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment(id);

-- Add customer feedback table
CREATE TABLE public.customer_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  agent_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on customer_feedback
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

-- RLS policies for customer_feedback
CREATE POLICY "Authenticated users can view feedback"
ON public.customer_feedback FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Agents can create feedback"
ON public.customer_feedback FOR INSERT
WITH CHECK (agent_id = auth.uid());

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_feedback;

-- Create indexes for better query performance
CREATE INDEX idx_equipment_customer_id ON public.equipment(customer_id);
CREATE INDEX idx_leads_customer_id ON public.leads(customer_id);
CREATE INDEX idx_leads_equipment_id ON public.leads(equipment_id);
CREATE INDEX idx_invoices_lead_id ON public.invoices(lead_id);
CREATE INDEX idx_invoices_agent_id ON public.invoices(agent_id);
CREATE INDEX idx_customer_feedback_customer_id ON public.customer_feedback(customer_id);