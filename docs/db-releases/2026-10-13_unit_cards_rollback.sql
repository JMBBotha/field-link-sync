-- Rollback for 2026-10-13_unit_cards.sql. Removes unit-card data (product_media rows) and the per-quote toggle.
DROP POLICY IF EXISTS "product-media public read" ON storage.objects;
DROP POLICY IF EXISTS "product-media owner write" ON storage.objects;
-- Bucket objects: empty the bucket in the Storage UI first, then: DELETE FROM storage.buckets WHERE id = 'product-media';
DROP FUNCTION IF EXISTS public.public_quote_show_unit_cards(uuid);
ALTER TABLE public.quotes DROP COLUMN IF EXISTS show_unit_cards;
DROP TABLE IF EXISTS public.product_media;
DROP FUNCTION IF EXISTS public.product_media_notify_draft();
DROP FUNCTION IF EXISTS public.product_media_touch();
DROP FUNCTION IF EXISTS public.normalize_model_code(text);
