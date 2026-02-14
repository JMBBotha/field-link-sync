-- Add missing UPDATE policy for supplier-pdf-pages storage bucket (upsert requires UPDATE)
CREATE POLICY "Authenticated users can update pdf page files"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'supplier-pdf-pages' AND auth.role() = 'authenticated');

-- Also add DELETE policy for supplier-pdfs bucket (may be needed for re-uploads)
CREATE POLICY "Authenticated users can delete supplier pdfs"
ON storage.objects
FOR DELETE
USING (bucket_id = 'supplier-pdfs' AND auth.uid() IS NOT NULL);