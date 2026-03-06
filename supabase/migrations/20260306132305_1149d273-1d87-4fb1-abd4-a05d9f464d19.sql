
-- Step 1: Drop the search function first (it references selling_price)
DROP FUNCTION IF EXISTS public.search_supplier_products(text, text, text, text, integer);

-- Step 2: Drop existing generated column selling_price
ALTER TABLE supplier_products DROP COLUMN IF EXISTS selling_price;

-- Step 3: Recreate selling_price with discount-aware formula
ALTER TABLE supplier_products ADD COLUMN selling_price numeric GENERATED ALWAYS AS (
  CASE 
    WHEN cost_excl_vat > 0 THEN 
      ROUND(cost_excl_vat * (1 - COALESCE(supplier_discount_percent, 0) / 100) * (1 + COALESCE(default_markup_percent, 20) / 100), 2)
    WHEN cost_price > 0 THEN 
      ROUND(cost_price * (1 + COALESCE(default_markup_percent, 20) / 100), 2)
    ELSE 0 
  END
) STORED;

-- Step 4: Add discounted_cost generated column
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS discounted_cost numeric GENERATED ALWAYS AS (
  CASE 
    WHEN cost_excl_vat > 0 THEN 
      ROUND(cost_excl_vat * (1 - COALESCE(supplier_discount_percent, 0) / 100), 2)
    WHEN cost_price > 0 THEN cost_price
    ELSE 0 
  END
) STORED;

-- Step 5: Recreate search function with new columns
CREATE FUNCTION public.search_supplier_products(search_term text DEFAULT ''::text, category_filter text DEFAULT 'all'::text, brand_filter text DEFAULT 'all'::text, sort_by text DEFAULT 'pinned'::text, max_results integer DEFAULT 100)
 RETURNS TABLE(id uuid, product_code text, short_name text, description text, cost_excl_vat numeric, cost_incl_vat numeric, selling_price numeric, rrp numeric, product_category text, category text, supplier_id uuid, supplier_name text, is_pinned boolean, pin_order integer, brand text, archived boolean, discounted_cost numeric, supplier_discount_percent numeric, default_markup_percent numeric)
 LANGUAGE sql
 STABLE
AS $$
  SELECT
    sp.id, sp.product_code, sp.short_name, sp.description,
    sp.cost_excl_vat, sp.cost_incl_vat, sp.selling_price, sp.rrp,
    sp.product_category, sp.category, sp.supplier_id,
    s.name as supplier_name, sp.is_pinned, sp.pin_order, sp.brand, sp.archived,
    sp.discounted_cost, sp.supplier_discount_percent, sp.default_markup_percent
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
