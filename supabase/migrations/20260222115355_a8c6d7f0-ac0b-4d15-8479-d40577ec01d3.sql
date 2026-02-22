-- Add pricing_mode column to supplier_products
ALTER TABLE public.supplier_products
ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'per-unit';

-- Backfill: set per-meter for copper pipe, drain pipe, trunking, electrical cable
UPDATE public.supplier_products
SET pricing_mode = 'per-meter'
WHERE sold_in_length = true
  AND price_per_metre IS NOT NULL
  AND price_per_metre > 0;

-- Force per-unit for remotes, brackets, tape, fittings, insulation
UPDATE public.supplier_products
SET pricing_mode = 'per-unit', sold_in_length = false
WHERE (
  LOWER(short_name) ~ '(remote|bracket|tape|fitting|insulation|sleeve|strap|clamp|saddle|hanger|hook|valve|filter|flare nut)'
  OR LOWER(product_code) ~ '(brc|ekr|brcw)'
)
AND pricing_mode != 'per-unit';