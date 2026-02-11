
-- Add consumable columns to supplier_products
ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'ac_unit',
  ADD COLUMN IF NOT EXISTS sold_in_length boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_length numeric NULL,
  ADD COLUMN IF NOT EXISTS unit_length_unit text NOT NULL DEFAULT 'm',
  ADD COLUMN IF NOT EXISTS price_per_metre numeric NULL,
  ADD COLUMN IF NOT EXISTS min_cut_length numeric NOT NULL DEFAULT 0.5;

-- Add supplier_type to suppliers
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS supplier_type text NOT NULL DEFAULT 'ac_units';

-- Add index for product_type filtering
CREATE INDEX IF NOT EXISTS idx_supplier_products_product_type ON public.supplier_products(product_type);
CREATE INDEX IF NOT EXISTS idx_suppliers_supplier_type ON public.suppliers(supplier_type);
