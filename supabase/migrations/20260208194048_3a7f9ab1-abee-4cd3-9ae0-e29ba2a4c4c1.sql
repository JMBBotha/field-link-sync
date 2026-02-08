
-- Create company_settings table
CREATE TABLE public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'My Company',
  vat_number text,
  physical_address text,
  postal_address text,
  logo_storage_path text,
  default_hourly_rate numeric DEFAULT 450,
  default_deposit_percentage numeric DEFAULT 50,
  default_payment_terms_days integer DEFAULT 30,
  payfast_merchant_id text,
  payfast_merchant_key text,
  banking_details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage company settings"
ON public.company_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view company settings"
ON public.company_settings FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Create logo storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view company logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'company-logos');

CREATE POLICY "Admins can upload company logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'company-logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update company logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'company-logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete company logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'company-logos' AND has_role(auth.uid(), 'admin'::app_role));
