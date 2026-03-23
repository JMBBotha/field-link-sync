INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-brochures', 'product-brochures', true, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read product brochures" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-brochures');

CREATE POLICY "Authenticated upload product brochures" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-brochures' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete product brochures" ON storage.objects
  FOR DELETE USING (bucket_id = 'product-brochures' AND auth.role() = 'authenticated');