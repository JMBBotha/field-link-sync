
-- Add product_category to supplier_products for richer categorization
ALTER TABLE public.supplier_products 
ADD COLUMN IF NOT EXISTS product_category TEXT NOT NULL DEFAULT 'Air Conditioning';

-- Add brand column to supplier_products for sub-brand tracking (Samsung, Comfy, Alliance)
ALTER TABLE public.supplier_products 
ADD COLUMN IF NOT EXISTS brand TEXT;

-- Create index on product_category for efficient filtering
CREATE INDEX IF NOT EXISTS idx_supplier_products_product_category ON public.supplier_products(product_category);

-- Create index on brand for efficient filtering
CREATE INDEX IF NOT EXISTS idx_supplier_products_brand ON public.supplier_products(brand);
