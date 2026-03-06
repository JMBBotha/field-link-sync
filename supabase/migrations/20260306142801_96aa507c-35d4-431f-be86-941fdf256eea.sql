
-- Step 1: Backfill cost_price from cost_excl_vat where missing
UPDATE supplier_products 
SET cost_price = cost_excl_vat 
WHERE (cost_price IS NULL OR cost_price = 0) AND cost_excl_vat IS NOT NULL AND cost_excl_vat > 0;

-- Step 2: Drop old generated columns
ALTER TABLE supplier_products DROP COLUMN IF EXISTS selling_price;
ALTER TABLE supplier_products DROP COLUMN IF EXISTS discounted_cost;
ALTER TABLE supplier_products DROP COLUMN IF EXISTS rrp;

-- Step 3: Recreate selling_price with SIMPLE formula: cost_price * (1 + markup/100)
ALTER TABLE supplier_products ADD COLUMN selling_price numeric GENERATED ALWAYS AS (
  ROUND(COALESCE(cost_price, 0) * (1.0 + COALESCE(default_markup_percent, 20) / 100.0), 2)
) STORED;

-- Step 4: Update the 5-param search function to handle removed columns
CREATE OR REPLACE FUNCTION public.search_supplier_products(
  search_term text DEFAULT ''::text, 
  category_filter text DEFAULT 'all'::text, 
  brand_filter text DEFAULT 'all'::text, 
  sort_by text DEFAULT 'pinned'::text, 
  max_results integer DEFAULT 100
)
RETURNS TABLE(
  id uuid, product_code text, short_name text, description text, 
  cost_excl_vat numeric, cost_incl_vat numeric, selling_price numeric, rrp numeric, 
  product_category text, category text, supplier_id uuid, supplier_name text, 
  is_pinned boolean, pin_order integer, brand text, archived boolean, 
  discounted_cost numeric, supplier_discount_percent numeric, default_markup_percent numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    sp.id, sp.product_code, sp.short_name, sp.description,
    sp.cost_excl_vat, sp.cost_incl_vat, sp.selling_price, 
    ROUND(COALESCE(sp.selling_price, 0) * 1.15, 2) as rrp,
    sp.product_category, sp.category, sp.supplier_id,
    s.name as supplier_name, sp.is_pinned, sp.pin_order, sp.brand, sp.archived,
    sp.cost_price as discounted_cost,
    sp.supplier_discount_percent, sp.default_markup_percent
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id
  WHERE
    (sp.is_active IS NULL OR sp.is_active = true)
    AND (sp.archived IS NULL OR sp.archived = false)
    AND (
      category_filter = 'all'
      OR sp.product_category = category_filter
      OR sp.category ILIKE '%' || category_filter || '%'
    )
    AND (
      brand_filter = 'all'
      OR sp.brand ILIKE '%' || brand_filter || '%'
      OR s.name ILIKE '%' || brand_filter || '%'
    )
    AND (
      search_term = ''
      OR sp.product_code ILIKE '%' || search_term || '%'
      OR sp.short_name ILIKE '%' || search_term || '%'
      OR sp.description ILIKE '%' || search_term || '%'
      OR sp.brand ILIKE '%' || search_term || '%'
      OR sp.category ILIKE '%' || search_term || '%'
      OR s.name ILIKE '%' || search_term || '%'
    )
  ORDER BY
    CASE WHEN sort_by = 'pinned' THEN
      CASE WHEN sp.is_pinned THEN 0 ELSE 1 END
    ELSE 1 END,
    CASE WHEN sort_by = 'pinned' THEN sp.pin_order END NULLS LAST,
    CASE WHEN sort_by = 'price_asc' THEN sp.selling_price END ASC NULLS LAST,
    CASE WHEN sort_by = 'price_desc' THEN sp.selling_price END DESC NULLS LAST,
    sp.short_name ASC
  LIMIT max_results;
$$;
