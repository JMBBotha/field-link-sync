
CREATE OR REPLACE FUNCTION public.search_supplier_products(p_query text, p_category text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_include_archived boolean DEFAULT false)
 RETURNS TABLE(id uuid, supplier_id uuid, supplier_name text, product_code text, description text, category text, subcategory text, pipe_size text, cost_price numeric, default_markup_percent numeric, selling_price numeric, is_price_on_request boolean, btu_rating integer, refrigerant_type text, image_url text, quote_usage_count integer, last_quoted_at timestamp with time zone, search_rank real, archived boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sp.id,
    sp.supplier_id,
    s.name as supplier_name,
    sp.product_code,
    sp.description,
    sp.category,
    sp.subcategory,
    sp.pipe_size,
    sp.cost_price,
    sp.default_markup_percent,
    sp.selling_price,
    sp.is_price_on_request,
    sp.btu_rating,
    sp.refrigerant_type,
    sp.image_url,
    sp.quote_usage_count,
    sp.last_quoted_at,
    CASE
      WHEN p_query IS NULL OR p_query = '' THEN 0
      ELSE ts_rank(
        to_tsvector('english', sp.product_code || ' ' || sp.description || ' ' || sp.category || ' ' || COALESCE(sp.subcategory, '') || ' ' || COALESCE(sp.pipe_size, '')),
        plainto_tsquery('english', p_query)
      )
    END as search_rank,
    sp.archived
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id
  WHERE sp.is_active = true
    AND (p_include_archived = true OR sp.archived = false)
    AND (p_category IS NULL OR sp.category = p_category)
    AND (p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id)
    AND (
      p_query IS NULL OR p_query = ''
      OR to_tsvector('english', sp.product_code || ' ' || sp.description || ' ' || sp.category || ' ' || COALESCE(sp.subcategory, '') || ' ' || COALESCE(sp.pipe_size, ''))
         @@ plainto_tsquery('english', p_query)
      OR sp.product_code ILIKE '%' || p_query || '%'
      OR sp.description ILIKE '%' || p_query || '%'
    )
  ORDER BY
    sp.quote_usage_count DESC,
    search_rank DESC,
    sp.description ASC
  LIMIT p_limit;
END;
$function$;
