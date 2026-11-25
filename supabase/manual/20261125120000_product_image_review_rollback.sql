-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- For 20261125120000_product_image_review.sql. Not applied until go-live.
-- Drops the auto-found photo review columns. Does not change prices or delete storage files.

ALTER TABLE public.supplier_products DROP COLUMN IF EXISTS image_needs_review;
ALTER TABLE public.supplier_products DROP COLUMN IF EXISTS image_source_url;
ALTER TABLE public.product_media DROP COLUMN IF EXISTS needs_review;
