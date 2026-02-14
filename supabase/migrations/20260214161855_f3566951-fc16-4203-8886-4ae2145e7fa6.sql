
-- Add new columns to existing suppliers table
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS physical_address text,
  ADD COLUMN IF NOT EXISTS postal_address text,
  ADD COLUMN IF NOT EXISTS logo_url text;

-- Backfill company_name from name for existing rows
UPDATE public.suppliers SET company_name = name WHERE company_name IS NULL;

-- Create supplier_contacts table
CREATE TABLE public.supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  email text,
  phone text,
  mobile text,
  department text,
  location_branch text,
  role_title text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;

-- RLS policies for supplier_contacts
CREATE POLICY "Admins can manage supplier contacts"
  ON public.supplier_contacts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view supplier contacts"
  ON public.supplier_contacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create storage bucket for supplier documents
INSERT INTO storage.buckets (id, name, public) VALUES ('supplier-documents', 'supplier-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for supplier-documents bucket
CREATE POLICY "Admins can upload supplier documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'supplier-documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can view supplier documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'supplier-documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete supplier documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'supplier-documents' AND auth.uid() IS NOT NULL);

-- Create supplier_documents table to track uploaded files
CREATE TABLE public.supplier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_type text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage supplier documents"
  ON public.supplier_documents FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view supplier documents"
  ON public.supplier_documents FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at on supplier_contacts
CREATE TRIGGER update_supplier_contacts_updated_at
  BEFORE UPDATE ON public.supplier_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
