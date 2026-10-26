-- Rollback for 20261026200000_quote_drawings.sql. Empty the bucket first (Storage UI or API) if files exist.
DROP POLICY IF EXISTS qdraw_select ON storage.objects;
DROP POLICY IF EXISTS qdraw_insert ON storage.objects;
DROP POLICY IF EXISTS qdraw_delete ON storage.objects;
DROP FUNCTION IF EXISTS public.public_quote_drawings(uuid);
DROP TABLE IF EXISTS public.quote_drawings CASCADE;
DROP TABLE IF EXISTS public.quote_drawings_deleted_files CASCADE;
DROP FUNCTION IF EXISTS public.quote_drawings_queue_delete();
DROP FUNCTION IF EXISTS public.quote_drawings_guard();
DROP FUNCTION IF EXISTS public.quote_drawing_path_ok(text, boolean);
DROP FUNCTION IF EXISTS public.drawing_quote_ok(uuid);
DROP FUNCTION IF EXISTS public.drawing_admin_ok(uuid);
DELETE FROM storage.buckets WHERE id = 'quote-drawings' AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='quote-drawings');
