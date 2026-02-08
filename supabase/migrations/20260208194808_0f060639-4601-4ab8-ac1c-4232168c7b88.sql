
-- Create flat_rate_items table
CREATE TABLE public.flat_rate_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  standard_price NUMERIC NOT NULL,
  estimated_hours NUMERIC,
  parts JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.flat_rate_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view flat rate items"
  ON public.flat_rate_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can create flat rate items"
  ON public.flat_rate_items FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update flat rate items"
  ON public.flat_rate_items FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete flat rate items"
  ON public.flat_rate_items FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create job_schedules table
CREATE TABLE public.job_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID NOT NULL,
  scheduled_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.job_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all schedules"
  ON public.job_schedules FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can view own schedules"
  ON public.job_schedules FOR SELECT
  USING (agent_id = auth.uid());

CREATE POLICY "Admins can create schedules"
  ON public.job_schedules FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update schedules"
  ON public.job_schedules FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete schedules"
  ON public.job_schedules FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Performance indexes
CREATE INDEX idx_job_schedules_agent_date ON public.job_schedules (agent_id, scheduled_date);
CREATE INDEX idx_job_schedules_lead ON public.job_schedules (lead_id);
CREATE INDEX idx_flat_rate_items_category ON public.flat_rate_items (category, is_active);

-- Seed flat rate items with common HVAC services
INSERT INTO public.flat_rate_items (category, name, description, standard_price, estimated_hours) VALUES
  ('Installation', 'Split System 9kW Install', 'Supply and install 9kW split system air conditioner including piping, electrical, and commissioning', 12500, 6),
  ('Installation', 'Split System 12kW Install', 'Supply and install 12kW split system air conditioner including piping, electrical, and commissioning', 15800, 8),
  ('Installation', 'Ducted System Install', 'Supply and install ducted air conditioning system including ductwork, grilles, and commissioning', 45000, 24),
  ('Installation', 'VRV/VRF Installation per unit', 'Supply and install VRV/VRF indoor unit including piping and electrical connections', 8500, 4),
  ('Installation', 'Cassette Unit Install', 'Supply and install ceiling cassette unit including piping and electrical', 18500, 10),
  ('Repair', 'AC Repair Diagnosis Fee', 'On-site diagnostic assessment and fault-finding for air conditioning systems', 750, 1),
  ('Repair', 'Compressor Replacement', 'Remove and replace faulty compressor including gas charge and testing', 8500, 6),
  ('Repair', 'PCB Board Replacement', 'Diagnose and replace faulty printed circuit board', 3500, 2),
  ('Repair', 'Fan Motor Replacement', 'Replace indoor or outdoor fan motor including testing', 2800, 2),
  ('Service', 'Regassing Service', 'Full system regas with refrigerant including leak test', 1200, 1.5),
  ('Service', 'Annual Maintenance Contract', 'Comprehensive annual maintenance service agreement', 2400, 2),
  ('Service', 'Quarterly Maintenance', 'Quarterly preventive maintenance service visit', 850, 1.5),
  ('Service', 'Filter Deep Clean', 'Remove, deep clean, and sanitize all filters and indoor unit', 450, 1),
  ('Ductwork', 'Duct Cleaning per m²', 'Professional duct cleaning and sanitization per square meter', 150, 0.5),
  ('Ductwork', 'Duct Repair/Sealing', 'Repair and seal ductwork joints and connections', 2500, 3),
  ('Electrical', 'Isolator Installation', 'Install dedicated electrical isolator for AC unit', 1500, 1.5),
  ('Electrical', 'DB Board Connection', 'Connect AC unit to distribution board with dedicated breaker', 2200, 2);
