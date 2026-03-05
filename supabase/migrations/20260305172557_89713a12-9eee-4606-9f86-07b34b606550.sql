
-- Create a public temp bucket for PDF page images
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdf-page-temps', 'pdf-page-temps', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone authenticated to upload to this bucket
CREATE POLICY "Authenticated users can upload pdf page temps"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'pdf-page-temps');

-- Allow public read access
CREATE POLICY "Public read access for pdf page temps"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'pdf-page-temps');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Authenticated users can delete pdf page temps"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'pdf-page-temps');
