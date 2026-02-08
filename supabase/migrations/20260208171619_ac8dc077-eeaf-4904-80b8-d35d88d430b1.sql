
-- Create service_templates table for predefined HVAC services
CREATE TABLE public.service_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_rate NUMERIC NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'general',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.service_templates ENABLE ROW LEVEL SECURITY;

-- Policies - viewable by all authenticated users, manageable by admins
CREATE POLICY "Authenticated users can view service templates"
ON public.service_templates FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can create service templates"
ON public.service_templates FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update service templates"
ON public.service_templates FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete service templates"
ON public.service_templates FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add due_date and paid_date columns to invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_date DATE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issue_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Seed default HVAC service templates
INSERT INTO public.service_templates (name, description, default_rate, category) VALUES
  ('AC Service', 'Standard air conditioning service and maintenance', 680, 'maintenance'),
  ('AC Repair', 'Air conditioning repair and diagnostics', 1380, 'repair'),
  ('AC Installation', 'New air conditioning unit installation', 0, 'installation'),
  ('Heater Service', 'Heater maintenance and cleaning', 580, 'maintenance'),
  ('Heater Repair', 'Heater repair and diagnostics', 1200, 'repair'),
  ('Vent Cleaning', 'Ventilation duct cleaning service', 450, 'maintenance'),
  ('Heat Pump Service', 'Heat pump maintenance service', 750, 'maintenance'),
  ('Heat Pump Repair', 'Heat pump repair and diagnostics', 1500, 'repair'),
  ('Callout Fee', 'Standard callout/inspection fee', 350, 'general'),
  ('Filter Replacement', 'Air filter replacement', 250, 'parts');
