-- Add suggested_consumables jsonb column to supplier_products
ALTER TABLE public.supplier_products
ADD COLUMN IF NOT EXISTS suggested_consumables jsonb DEFAULT '[]'::jsonb;