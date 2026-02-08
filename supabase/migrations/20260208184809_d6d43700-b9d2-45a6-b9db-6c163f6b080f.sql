
-- Quote number sequence
CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  next_val integer;
  current_year text;
BEGIN
  next_val := nextval('quote_number_seq');
  current_year := to_char(now(), 'YYYY');
  RETURN 'Q-' || current_year || '-' || LPAD(next_val::text, 4, '0');
END;
$$;

-- HVAC Services catalog
CREATE TABLE public.hvac_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('installation', 'repair', 'maintenance', 'duct_cleaning', 'vrv_vrf', 'other')),
  default_price numeric(10,2) NOT NULL,
  unit text NOT NULL DEFAULT 'each',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Quote Templates
CREATE TABLE public.quote_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Quote Template Items
CREATE TABLE public.quote_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.quote_templates(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.hvac_services(id),
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Quotes
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  sales_engineer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined')),
  quote_number text UNIQUE NOT NULL DEFAULT generate_quote_number(),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.15,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  valid_until date DEFAULT (CURRENT_DATE + 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  accepted_by text
);

-- Quote Line Items (with generated total column)
CREATE TABLE public.quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.hvac_services(id),
  description text NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  total numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Quote Attachments
CREATE TABLE public.quote_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename text,
  caption text,
  annotation jsonb,
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.hvac_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_attachments ENABLE ROW LEVEL SECURITY;

-- RLS: hvac_services
CREATE POLICY "Authenticated users can view hvac services" ON public.hvac_services FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can insert hvac services" ON public.hvac_services FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update hvac services" ON public.hvac_services FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete hvac services" ON public.hvac_services FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS: quote_templates
CREATE POLICY "Authenticated users can view templates" ON public.quote_templates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can insert templates" ON public.quote_templates FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update templates" ON public.quote_templates FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete templates" ON public.quote_templates FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS: quote_template_items
CREATE POLICY "Authenticated users can view template items" ON public.quote_template_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can insert template items" ON public.quote_template_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update template items" ON public.quote_template_items FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete template items" ON public.quote_template_items FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS: quotes
CREATE POLICY "Users can view own quotes or admin all" ON public.quotes FOR SELECT USING (sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can create quotes" ON public.quotes FOR INSERT WITH CHECK (sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can update own quotes" ON public.quotes FOR UPDATE USING (sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete quotes" ON public.quotes FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS: quote_line_items
CREATE POLICY "Users can view quote line items" ON public.quote_line_items FOR SELECT USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_line_items.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can insert quote line items" ON public.quote_line_items FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_line_items.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can update quote line items" ON public.quote_line_items FOR UPDATE USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_line_items.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can delete quote line items" ON public.quote_line_items FOR DELETE USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_line_items.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- RLS: quote_attachments
CREATE POLICY "Users can view quote attachments" ON public.quote_attachments FOR SELECT USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_attachments.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can insert quote attachments" ON public.quote_attachments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_attachments.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can delete quote attachments" ON public.quote_attachments FOR DELETE USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_attachments.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- Storage bucket for quote photos
INSERT INTO storage.buckets (id, name, public) VALUES ('quote-photos', 'quote-photos', true);

CREATE POLICY "Auth users can upload quote photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'quote-photos' AND auth.uid() IS NOT NULL);
CREATE POLICY "Anyone can view quote photos" ON storage.objects FOR SELECT USING (bucket_id = 'quote-photos');
CREATE POLICY "Auth users can delete own quote photos" ON storage.objects FOR DELETE USING (bucket_id = 'quote-photos' AND auth.uid() IS NOT NULL);

-- Seed HVAC services
INSERT INTO public.hvac_services (name, category, default_price, unit) VALUES
  ('Split Unit Installation - 9kW', 'installation', 8500.00, 'each'),
  ('Split Unit Installation - 12kW', 'installation', 11000.00, 'each'),
  ('Split Unit Installation - 18kW', 'installation', 15500.00, 'each'),
  ('Split Unit Installation - 24kW', 'installation', 22000.00, 'each'),
  ('Ducted System Installation', 'installation', 45000.00, 'each'),
  ('VRV/VRF System', 'vrv_vrf', 85000.00, 'each'),
  ('AC Repair / Service Call', 'repair', 850.00, 'each'),
  ('Duct Cleaning', 'duct_cleaning', 2500.00, 'each'),
  ('Annual Maintenance Contract', 'maintenance', 3600.00, 'each'),
  ('Compressor Replacement', 'repair', 6500.00, 'each'),
  ('Gas Recharge', 'repair', 1200.00, 'each'),
  ('Thermostat Installation', 'installation', 1800.00, 'each'),
  ('Filter Replacement', 'maintenance', 450.00, 'each');

-- Seed quote templates
INSERT INTO public.quote_templates (name, category, description) VALUES
  ('9kW Split Installation', 'installation', 'Standard 9kW split unit installation package'),
  ('12kW Split Installation', 'installation', 'Standard 12kW split unit installation package'),
  ('Annual Maintenance Contract', 'maintenance', 'Annual preventive maintenance agreement'),
  ('Ducted System Installation', 'installation', 'Full ducted system installation with commissioning');
