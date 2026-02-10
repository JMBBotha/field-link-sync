
-- Enable pg_trgm for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add new columns to existing customers table (keeping existing name/phone/email/address for backward compat)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS is_company boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS secondary_phone text,
  ADD COLUMN IF NOT EXISTS primary_address_line1 text,
  ADD COLUMN IF NOT EXISTS primary_address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_email text;

-- Migrate existing data: split name into first_name / last_name
UPDATE public.customers
SET 
  first_name = COALESCE(
    CASE WHEN position(' ' in name) > 0 THEN substring(name from 1 for position(' ' in name) - 1) ELSE name END,
    name
  ),
  last_name = CASE WHEN position(' ' in name) > 0 THEN substring(name from position(' ' in name) + 1) ELSE '' END,
  primary_address_line1 = COALESCE(primary_address_line1, address),
  status = COALESCE(status, 'active'),
  normalized_phone = regexp_replace(phone, '[^0-9]', '', 'g'),
  normalized_email = lower(trim(COALESCE(email, '')))
WHERE first_name IS NULL;

-- Create customer_units table
CREATE TABLE IF NOT EXISTS public.customer_units (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  label text NOT NULL,
  full_address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on customer_units
ALTER TABLE public.customer_units ENABLE ROW LEVEL SECURITY;

-- RLS policies for customer_units (same pattern as customers)
CREATE POLICY "Authenticated users can view customer units"
  ON public.customer_units FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and agents can create customer units"
  ON public.customer_units FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and agents can update customer units"
  ON public.customer_units FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete customer units"
  ON public.customer_units FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add unit_id to leads table for unit-level tracking
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.customer_units(id);

-- Add unit_id to service_agreements
ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.customer_units(id);

-- Create trigram indexes for fast fuzzy search
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON public.customers USING gin ((first_name || ' ' || COALESCE(last_name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_company_trgm ON public.customers USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers (normalized_phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers (normalized_email);
CREATE INDEX IF NOT EXISTS idx_customers_address_trgm ON public.customers USING gin (primary_address_line1 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customer_units_label_trgm ON public.customer_units USING gin (label gin_trgm_ops);

-- Function to normalize phone numbers (SA format)
CREATE OR REPLACE FUNCTION public.normalize_phone(phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  digits text;
BEGIN
  IF phone IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(phone, '[^0-9]', '', 'g');
  -- Remove leading country code 27
  IF left(digits, 2) = '27' AND length(digits) > 9 THEN
    digits := '0' || substring(digits from 3);
  END IF;
  -- Ensure leading zero
  IF left(digits, 1) != '0' AND length(digits) = 9 THEN
    digits := '0' || digits;
  END IF;
  RETURN digits;
END;
$$;

-- Trigger to auto-normalize phone and email on insert/update
CREATE OR REPLACE FUNCTION public.normalize_customer_contacts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.normalized_phone := normalize_phone(COALESCE(NEW.phone, NEW.primary_phone));
  NEW.normalized_email := lower(trim(COALESCE(NEW.email, '')));
  -- Keep name in sync with first_name + last_name
  IF NEW.first_name IS NOT NULL THEN
    NEW.name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_customer_contacts ON public.customers;
CREATE TRIGGER trg_normalize_customer_contacts
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_customer_contacts();

-- Search function for fuzzy customer search
CREATE OR REPLACE FUNCTION public.search_customers(search_term text, max_results integer DEFAULT 20)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  company_name text,
  is_company boolean,
  phone text,
  email text,
  primary_address_line1 text,
  city text,
  status text,
  relevance real
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm_term text;
  phone_term text;
BEGIN
  IF search_term IS NULL OR trim(search_term) = '' THEN
    RETURN QUERY
      SELECT c.id, c.first_name, c.last_name, c.company_name, c.is_company,
             c.phone, c.email, c.primary_address_line1, c.city, c.status, 1.0::real
      FROM customers c
      ORDER BY c.updated_at DESC
      LIMIT max_results;
    RETURN;
  END IF;

  norm_term := lower(trim(search_term));
  phone_term := regexp_replace(search_term, '[^0-9]', '', 'g');

  RETURN QUERY
    SELECT c.id, c.first_name, c.last_name, c.company_name, c.is_company,
           c.phone, c.email, c.primary_address_line1, c.city, c.status,
           GREATEST(
             similarity(lower(c.first_name || ' ' || COALESCE(c.last_name, '')), norm_term),
             similarity(lower(COALESCE(c.company_name, '')), norm_term),
             CASE WHEN c.normalized_email LIKE '%' || norm_term || '%' THEN 0.8 ELSE 0 END,
             CASE WHEN phone_term != '' AND c.normalized_phone LIKE '%' || phone_term || '%' THEN 0.9 ELSE 0 END,
             CASE WHEN lower(COALESCE(c.primary_address_line1, '')) ILIKE '%' || norm_term || '%' THEN 0.6 ELSE 0 END
           )::real AS relevance
    FROM customers c
    WHERE
      similarity(lower(c.first_name || ' ' || COALESCE(c.last_name, '')), norm_term) > 0.2
      OR similarity(lower(COALESCE(c.company_name, '')), norm_term) > 0.2
      OR c.normalized_email LIKE '%' || norm_term || '%'
      OR (phone_term != '' AND c.normalized_phone LIKE '%' || phone_term || '%')
      OR lower(COALESCE(c.primary_address_line1, '')) ILIKE '%' || norm_term || '%'
      OR lower(c.first_name || ' ' || COALESCE(c.last_name, '')) ILIKE '%' || norm_term || '%'
    ORDER BY relevance DESC
    LIMIT max_results;
END;
$$;

-- Dedup check function
CREATE OR REPLACE FUNCTION public.check_customer_duplicates(
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  phone text,
  email text,
  primary_address_line1 text,
  match_type text,
  match_score real
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm_phone text;
  norm_email text;
BEGIN
  norm_phone := normalize_phone(p_phone);
  norm_email := lower(trim(COALESCE(p_email, '')));

  RETURN QUERY
    SELECT c.id, c.first_name, c.last_name, c.phone, c.email, c.primary_address_line1,
      CASE
        WHEN norm_email != '' AND c.normalized_email = norm_email THEN 'exact_email'
        WHEN norm_phone IS NOT NULL AND c.normalized_phone = norm_phone THEN 'exact_phone'
        ELSE 'fuzzy_name'
      END AS match_type,
      GREATEST(
        CASE WHEN norm_email != '' AND c.normalized_email = norm_email THEN 1.0 ELSE 0 END,
        CASE WHEN norm_phone IS NOT NULL AND c.normalized_phone = norm_phone THEN 1.0 ELSE 0 END,
        similarity(
          lower(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')),
          lower(c.first_name || ' ' || COALESCE(c.last_name, ''))
        )
      )::real AS match_score
    FROM customers c
    WHERE
      (norm_email != '' AND c.normalized_email = norm_email)
      OR (norm_phone IS NOT NULL AND c.normalized_phone = norm_phone)
      OR (
        p_first_name IS NOT NULL AND
        similarity(
          lower(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')),
          lower(c.first_name || ' ' || COALESCE(c.last_name, ''))
        ) > 0.4
      )
    ORDER BY match_score DESC
    LIMIT 10;
END;
$$;
