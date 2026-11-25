-- Quote unit photos. Not applied live.
-- Where an auto-found catalogue photo came from, and that staff still need to keep or reject it.
-- The lookup writes these image columns only. Prices are not changed.

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS image_needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_source_url text;

ALTER TABLE public.product_media
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.supplier_products.image_needs_review IS 'Auto-found photo is waiting for staff to keep or reject it. The image lookup never writes prices.';
COMMENT ON COLUMN public.supplier_products.image_source_url IS 'Web page the auto-found photo came from. No client data.';
COMMENT ON COLUMN public.product_media.needs_review IS 'Auto-found cut-out is waiting for staff review.';
