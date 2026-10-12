-- Rollback 2026-10-12 quote-photos lockdown: restores the exact prior bucket flag and policies.
DROP POLICY IF EXISTS "qp_select" ON storage.objects;
DROP POLICY IF EXISTS "qp_insert" ON storage.objects;
DROP POLICY IF EXISTS "qp_update" ON storage.objects;
DROP POLICY IF EXISTS "qp_delete" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users can list public assets" ON storage.objects;
CREATE POLICY "Signed-in users can list public assets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['company-logos'::text, 'product-images'::text, 'quote-photos'::text]));
CREATE POLICY "Auth users can upload quote photos" ON storage.objects FOR INSERT
  WITH CHECK ((bucket_id = 'quote-photos'::text) AND (auth.uid() IS NOT NULL));
CREATE POLICY "Auth users can delete own quote photos" ON storage.objects FOR DELETE
  USING ((bucket_id = 'quote-photos'::text) AND (auth.uid() IS NOT NULL));
DROP FUNCTION IF EXISTS public.quote_photo_ok(text, boolean);
UPDATE storage.buckets SET public = true WHERE id = 'quote-photos';

DROP POLICY IF EXISTS "jp_delete" ON storage.objects;
CREATE POLICY "Admins can delete job photos" ON storage.objects FOR DELETE
  USING ((bucket_id = 'job-photos'::text) AND has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "jp_update" ON storage.objects;
CREATE POLICY "Uploaders can update their photos" ON storage.objects FOR UPDATE
  USING ((bucket_id = 'job-photos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]));
