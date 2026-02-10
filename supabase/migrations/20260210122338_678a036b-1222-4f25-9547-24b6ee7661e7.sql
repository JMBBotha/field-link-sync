
-- Add multi-price columns to supplier_products
ALTER TABLE public.supplier_products 
  ADD COLUMN IF NOT EXISTS cost_excl_vat numeric,
  ADD COLUMN IF NOT EXISTS cost_incl_vat numeric,
  ADD COLUMN IF NOT EXISTS rrp numeric,
  ADD COLUMN IF NOT EXISTS supplier_discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 15;

-- Add price config columns to suppliers table for remembering settings per supplier
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS default_price_column text DEFAULT 'cost_excl_vat',
  ADD COLUMN IF NOT EXISTS price_includes_vat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_includes_markup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_markup_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_vat_rate numeric NOT NULL DEFAULT 15;
