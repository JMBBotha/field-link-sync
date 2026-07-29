
DO $$ BEGIN
  CREATE TYPE public.pricing_unit_type AS ENUM ('each','m','g','kg','l','ml','roll','box','pack','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS unit_type public.pricing_unit_type NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS price_per_unit_qty NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_per_unit_label TEXT NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS allows_decimal_qty BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qty_step NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_qty NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE public.bundle_items
  ADD COLUMN IF NOT EXISTS unit_type public.pricing_unit_type NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS price_per_unit_qty NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_per_unit_label TEXT NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS allows_decimal_qty BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qty_step NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_qty NUMERIC NOT NULL DEFAULT 1;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS unit_type public.pricing_unit_type NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS price_per_unit_qty NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_per_unit_label TEXT NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS allows_decimal_qty BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qty_step NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_qty NUMERIC NOT NULL DEFAULT 1;

-- Backwards compatibility: existing length-based products become per-meter
UPDATE public.supplier_products
SET unit_type = 'm',
    price_per_unit_qty = 1,
    price_per_unit_label = 'm',
    allows_decimal_qty = true,
    qty_step = 0.1,
    min_qty = 0
WHERE sold_in_length IS TRUE;
