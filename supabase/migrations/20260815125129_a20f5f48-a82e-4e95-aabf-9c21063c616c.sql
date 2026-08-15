-- CORRECTION to migration 20260815120307: that migration used the wrong
-- formula for Samsung. It treated Samsung's PDF as "list price with a 20%
-- markup baked in over true cost" (true cost = list / 1.20), when the actual,
-- confirmed-correct structure is "list price minus a 20% trade discount"
-- (true cost = list * 0.80). These are NOT the same operation (1/1.20 =
-- 0.8333... vs 0.80), and critically, the existing 117 Samsung products had
-- ALREADY been correctly priced using the 0.80 discount formula at import
-- time (confirmed: cost_price * 1.25 resale markup exactly reproduces the
-- original PDF list price, which only happens with the 0.80 discount
-- formula: 0.80 * 1.25 = 1.0 exactly). So the previous migration's backfill
-- wrongly divided already-correct cost prices by 1.20 a second time,
-- under-pricing every Samsung product by ~16.7%.
--
-- This migration:
--   1. Reverts the erroneous backfill (multiplies cost fields back by 1.20,
--      which exactly restores the pre-backfill values since the previous
--      step divided by 1.20 and rounded to the same 2 decimal places).
--   2. Reconfigures Samsung as a "list price with 20% trade discount"
--      supplier (the pre-existing, correct discount mechanism) instead of
--      "list price with built-in markup".

-- 1. Undo the incorrect divide-by-1.20 backfill on Samsung products
UPDATE public.supplier_products sp
SET
  cost_price = ROUND(sp.cost_price * 1.20, 2),
  cost_excl_vat = ROUND(sp.cost_price * 1.20, 2),
  cost_incl_vat = CASE
    WHEN sp.cost_incl_vat IS NOT NULL THEN ROUND((sp.cost_price * 1.20) * (1 + COALESCE(sp.vat_rate, 15) / 100), 2)
    ELSE sp.cost_incl_vat
  END
FROM public.suppliers s
WHERE sp.supplier_id = s.id
  AND s.name ILIKE '%samsung%'
  AND sp.cost_price > 0;

-- 2. Reconfigure Samsung as "list price with 20% trade discount", not
--    "list price with built-in markup"
UPDATE public.suppliers
SET
  price_list_type = 'list_price_with_discount',
  price_includes_markup = false,
  supplier_markup_percent = 0,
  supplier_discount_percent = 20,
  default_trade_discount = 20
WHERE name ILIKE '%samsung%';