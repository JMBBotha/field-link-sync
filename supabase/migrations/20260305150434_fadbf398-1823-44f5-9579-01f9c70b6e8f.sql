
-- Supplier locations/branches table
CREATE TABLE IF NOT EXISTS public.supplier_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE NOT NULL,
  location_name TEXT NOT NULL,
  city TEXT,
  province TEXT,
  address TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  is_head_office BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add new columns to suppliers
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS head_office_address TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS main_phone TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS main_email TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS main_whatsapp TEXT;

-- Add new columns to supplier_contacts
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.supplier_locations(id) ON DELETE SET NULL;
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS direct_phone TEXT;
ALTER TABLE public.supplier_contacts ADD COLUMN IF NOT EXISTS extension TEXT;

-- RLS for supplier_locations
ALTER TABLE public.supplier_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read supplier_locations"
  ON public.supplier_locations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert supplier_locations"
  ON public.supplier_locations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update supplier_locations"
  ON public.supplier_locations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete supplier_locations"
  ON public.supplier_locations FOR DELETE TO authenticated USING (true);
