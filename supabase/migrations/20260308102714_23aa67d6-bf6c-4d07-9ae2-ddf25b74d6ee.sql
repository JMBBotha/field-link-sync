ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS row_bbox jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_bbox jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS page_number integer DEFAULT NULL;