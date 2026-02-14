-- Create supplier-pdfs storage bucket if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-pdfs', 'supplier-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload PDFs
CREATE POLICY "Authenticated users can upload supplier pdfs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'supplier-pdfs' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to read supplier pdfs
CREATE POLICY "Authenticated users can read supplier pdfs"
ON storage.objects FOR SELECT
USING (bucket_id = 'supplier-pdfs' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to update/overwrite supplier pdfs
CREATE POLICY "Authenticated users can update supplier pdfs"
ON storage.objects FOR UPDATE
USING (bucket_id = 'supplier-pdfs' AND auth.uid() IS NOT NULL);

-- Allow update on supplier_pdf_pages so we can set pdf_storage_path
CREATE POLICY "Authenticated users can update pdf pages"
ON public.supplier_pdf_pages FOR UPDATE
USING (auth.uid() IS NOT NULL);
