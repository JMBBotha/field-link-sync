
-- Add short_name, is_pinned, pin_order columns to supplier_products
ALTER TABLE public.supplier_products 
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_order integer NOT NULL DEFAULT 0;

-- Index for pinned sorting
CREATE INDEX IF NOT EXISTS idx_supplier_products_pinned ON public.supplier_products (is_pinned DESC, pin_order ASC);
