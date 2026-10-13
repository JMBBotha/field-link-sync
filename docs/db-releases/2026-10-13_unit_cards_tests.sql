-- Checks run 13 Oct after applying 2026-10-13_unit_cards.sql + seed.
SELECT model_key, status, image_status FROM public.product_media;            -- 3 drafts, image ready
SELECT count(*) FROM public.notifications WHERE type = 'unit_content_draft';  -- 3 (Massair admins)
SELECT public FROM storage.buckets WHERE id = 'product-media';                 -- true
SELECT public.normalize_model_code(' ar70f12c1fw/fa-DUP2');                   -- AR70F12C1FW/FA
BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.product_media; ROLLBACK; -- 0 (drafts hidden)
