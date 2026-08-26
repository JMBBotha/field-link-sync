ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS ai_sales_description text,
  ADD COLUMN IF NOT EXISTS ai_sales_description_generated_at timestamptz;