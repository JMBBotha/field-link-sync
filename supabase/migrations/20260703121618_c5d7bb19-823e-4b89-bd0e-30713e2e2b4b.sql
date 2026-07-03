
-- 1. customer_locations table
CREATE TABLE public.customer_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  label TEXT NOT NULL DEFAULT 'Primary',
  address TEXT NOT NULL,
  latitude NUMERIC,
  longitude NUMERIC,
  notes TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_locations_customer ON public.customer_locations(customer_id);
CREATE INDEX idx_customer_locations_company ON public.customer_locations(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_locations TO authenticated;
GRANT ALL ON public.customer_locations TO service_role;

ALTER TABLE public.customer_locations ENABLE ROW LEVEL SECURITY;

-- Reuse existing tenant helper if present, else fall back to a company match via customers
CREATE POLICY "Users view locations in their company"
  ON public.customer_locations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_locations.customer_id
        AND c.company_id = customer_locations.company_id
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.company_id = c.company_id
        )
    )
  );

CREATE POLICY "Users insert locations in their company"
  ON public.customer_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.company_id = customer_locations.company_id
    )
  );

CREATE POLICY "Users update locations in their company"
  ON public.customer_locations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.company_id = customer_locations.company_id
    )
  );

CREATE POLICY "Users delete locations in their company"
  ON public.customer_locations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.company_id = customer_locations.company_id
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_customer_locations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_customer_locations_updated_at
  BEFORE UPDATE ON public.customer_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_locations_updated_at();

-- Only one primary per customer
CREATE UNIQUE INDEX uniq_customer_primary_location
  ON public.customer_locations(customer_id)
  WHERE is_primary = true;

-- 2. Backfill one Primary location per existing customer that has an address
INSERT INTO public.customer_locations (customer_id, company_id, label, address, latitude, longitude, is_primary)
SELECT c.id, c.company_id, 'Primary',
       COALESCE(NULLIF(c.address, ''), c.primary_address_line1, 'Unknown'),
       c.latitude, c.longitude, true
FROM public.customers c
WHERE c.company_id IS NOT NULL
  AND (COALESCE(c.address,'') <> '' OR c.primary_address_line1 IS NOT NULL);

-- 3. Add location_id to jobs and quotes
ALTER TABLE public.jobs
  ADD COLUMN location_id UUID REFERENCES public.customer_locations(id) ON DELETE SET NULL;
CREATE INDEX idx_jobs_location ON public.jobs(location_id);

ALTER TABLE public.quotes
  ADD COLUMN location_id UUID REFERENCES public.customer_locations(id) ON DELETE SET NULL;
CREATE INDEX idx_quotes_location ON public.quotes(location_id);

-- 4. Backfill: link existing jobs/quotes to their customer's primary location
UPDATE public.jobs j
SET location_id = cl.id
FROM public.customer_locations cl
WHERE j.customer_id = cl.customer_id
  AND cl.is_primary = true
  AND j.location_id IS NULL;

UPDATE public.quotes q
SET location_id = cl.id
FROM public.customer_locations cl
WHERE q.customer_id = cl.customer_id
  AND cl.is_primary = true
  AND q.location_id IS NULL;
