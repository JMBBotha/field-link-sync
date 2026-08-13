-- Add AI-generated sales description caching columns to supplier_products
-- so the AI is only ever asked to write a description once per product.
ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS ai_sales_description text,
  ADD COLUMN IF NOT EXISTS ai_sales_description_generated_at timestamptz;

COMMENT ON COLUMN public.supplier_products.ai_sales_description IS
  'Cached AI-generated short sales description for use on Quotes/Estimates line items. Generated once by the generate-product-description edge function and reused thereafter unless explicitly regenerated.';
COMMENT ON COLUMN public.supplier_products.ai_sales_description_generated_at IS
  'Timestamp of when ai_sales_description was last generated.';
