
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS supplier_type TEXT NOT NULL DEFAULT 'ac_units';
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'ac_unit';
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS sold_in_length BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS unit_length DECIMAL;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS price_per_metre DECIMAL;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS min_cut_length DECIMAL NOT NULL DEFAULT 0.5;
