
CREATE POLICY "Authenticated can upload invoice attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'invoice-attachments');

CREATE POLICY "Authenticated can read invoice attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'invoice-attachments');

CREATE POLICY "Authenticated can update invoice attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'invoice-attachments')
WITH CHECK (bucket_id = 'invoice-attachments');

CREATE POLICY "Authenticated can delete invoice attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'invoice-attachments');
