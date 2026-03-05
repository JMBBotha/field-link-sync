
-- Create pdf_uploads table
CREATE TABLE IF NOT EXISTS public.pdf_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT,
  storage_path TEXT,
  file_url TEXT,
  status TEXT DEFAULT 'uploaded',
  page_count INTEGER DEFAULT 0,
  price_list_type TEXT,
  trade_discount_percent NUMERIC(5,2) DEFAULT 0,
  markup_percent NUMERIC(5,2) DEFAULT 20,
  price_includes_vat BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage pdf_uploads" ON public.pdf_uploads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create import_audit_log table
CREATE TABLE IF NOT EXISTS public.import_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  products_deleted INTEGER DEFAULT 0,
  products_imported INTEGER DEFAULT 0,
  pdfs_deleted INTEGER DEFAULT 0,
  file_name TEXT,
  import_settings JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.import_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage import_audit_log" ON public.import_audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add missing columns to supplier_products
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS list_price_raw NUMERIC(12,2);
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS price_includes_vat BOOLEAN DEFAULT false;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS price_excl_vat NUMERIC(12,2);
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS sell_price_incl_vat NUMERIC(12,2);
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12,2);
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS import_confidence TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS import_flags TEXT[];
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS pdf_upload_id UUID REFERENCES public.pdf_uploads(id) ON DELETE SET NULL;

-- Ensure storage buckets exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-pdfs', 'supplier-pdfs', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('pdfs', 'pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for supplier-pdfs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated uploads to supplier-pdfs') THEN
    CREATE POLICY "Allow authenticated uploads to supplier-pdfs" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'supplier-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated reads from supplier-pdfs') THEN
    CREATE POLICY "Allow authenticated reads from supplier-pdfs" ON storage.objects
      FOR SELECT TO authenticated USING (bucket_id = 'supplier-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated deletes from supplier-pdfs') THEN
    CREATE POLICY "Allow authenticated deletes from supplier-pdfs" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'supplier-pdfs');
  END IF;
END $$;
