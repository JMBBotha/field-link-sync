-- Fix Samsung double-markup bug:
-- Samsung's PDF price list already has the distributor's own ~20% markup baked
-- into the listed price. The importer was storing that raw PDF price directly
-- as cost_price with no adjustment, then applying our resale markup on top of
-- it -- a double markup. This migration:
--   1. Configures Samsung's supplier row to correctly describe its PDF as
--      "list price with a built-in 20% markup" (price_includes_markup = true,
--      supplier_markup_percent = 20), using the newly unified pricing config
--      columns that both the persistent Pricing tab and the PriceConfigPanel
--      import wizard read from.
--   2. Backfills the already-imported Samsung supplier_products rows: divides
--      out the 20% built-in markup from cost_price/cost_excl_vat/cost_incl_vat
--      so cost_price becomes the true buy cost. selling_price is a generated
--      column (cost_price * (1 + default_markup_percent / 100)) so it
--      recalculates automatically once cost_price is corrected -- the resale
--      markup already on each row (25%) is left untouched.
-- Already-created quotes are unaffected: quote_items snapshot unit_price /
-- total_price at the time they were quoted and do not read live product cost.

-- 1. Correct Samsung's supplier-level pricing configuration
UPDATE public.suppliers
SET
  price_list_type = 'list_price_with_markup',
  price_includes_markup = true,
  supplier_markup_percent = 20,
  supplier_discount_percent = 0,
  default_trade_discount = 0
WHERE name ILIKE '%samsung%';

-- 2. Backfill existing Samsung products: strip the 20% built-in markup from
--    cost fields that were stored raw (undiscounted) at import time.
UPDATE public.supplier_products sp
SET
  cost_price = ROUND(sp.cost_price / 1.20, 2),
  cost_excl_vat = ROUND(sp.cost_price / 1.20, 2),
  cost_incl_vat = CASE
    WHEN sp.cost_incl_vat IS NOT NULL THEN ROUND((sp.cost_price / 1.20) * (1 + COALESCE(sp.vat_rate, 15) / 100), 2)
    ELSE sp.cost_incl_vat
  END
FROM public.suppliers s
WHERE sp.supplier_id = s.id
  AND s.name ILIKE '%samsung%'
  AND sp.cost_price > 0;
