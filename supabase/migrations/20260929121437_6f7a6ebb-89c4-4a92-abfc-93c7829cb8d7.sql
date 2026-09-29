-- Rollback: restore previous body (name-only labour re-link):
-- CREATE OR REPLACE FUNCTION public.replace_quote_from_builder(
--   p_quote_id uuid, p_areas jsonb, p_items jsonb,
--   p_subtotal numeric, p_vat_rate numeric, p_vat_amount numeric, p_total numeric
-- ) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
-- DECLARE v_old_ids uuid[];
-- BEGIN
--   PERFORM pg_advisory_xact_lock(hashtext(p_quote_id::text));
--   CREATE TEMP TABLE IF NOT EXISTS _rqfb_old_areas (id uuid, nm text) ON COMMIT DROP;
--   DELETE FROM _rqfb_old_areas;
--   INSERT INTO _rqfb_old_areas SELECT id, lower(trim(coalesce(name, ''))) FROM quote_areas WHERE quote_id = p_quote_id;
--   SELECT coalesce(array_agg(id), '{}') INTO v_old_ids FROM _rqfb_old_areas;
--   INSERT INTO quote_areas (id, quote_id, name, sort_order)
--   SELECT (a->>'id')::uuid, p_quote_id, a->>'name', coalesce((a->>'sort_order')::int, 0)
--   FROM jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) a;
--   UPDATE quote_items qi SET area_id = na.id
--   FROM _rqfb_old_areas oa,
--        (SELECT (a->>'id')::uuid AS id, lower(trim(coalesce(a->>'name', ''))) AS nm
--         FROM jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) a) na
--   WHERE qi.quote_id = p_quote_id AND qi.item_type = 'labour' AND qi.parent_item_id IS NULL
--     AND qi.area_id = oa.id AND oa.nm = na.nm;
--   DELETE FROM quote_items WHERE quote_id = p_quote_id AND item_type IS DISTINCT FROM 'labour';
--   DELETE FROM quote_areas WHERE quote_id = p_quote_id AND id = ANY(v_old_ids);
--   INSERT INTO quote_items (id, quote_id, area_id, parent_item_id, product_id, item_name, item_number,
--     description, quantity, length, unit_price, total_price, is_bundle, item_type, metadata,
--     sort_order, notes, source, supplier)
--   SELECT r.id, p_quote_id, r.area_id, r.parent_item_id, r.product_id, r.item_name, r.item_number,
--     r.description, r.quantity, r.length, r.unit_price, r.total_price, coalesce(r.is_bundle, false), r.item_type,
--     coalesce(r.metadata, '{}'::jsonb), coalesce(r.sort_order, 0), r.notes, r.source, r.supplier
--   FROM jsonb_populate_recordset(NULL::quote_items, coalesce(p_items, '[]'::jsonb)) r;
--   UPDATE quotes SET subtotal = p_subtotal, vat_rate = p_vat_rate, vat_amount = p_vat_amount, total = p_total WHERE id = p_quote_id;
-- END; $$;
CREATE OR REPLACE FUNCTION public.replace_quote_from_builder(
  p_quote_id uuid, p_areas jsonb, p_items jsonb,
  p_subtotal numeric, p_vat_rate numeric, p_vat_amount numeric, p_total numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_ids uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_quote_id::text));

  CREATE TEMP TABLE IF NOT EXISTS _rqfb_old_areas (id uuid, nm text) ON COMMIT DROP;
  DELETE FROM _rqfb_old_areas;
  INSERT INTO _rqfb_old_areas SELECT id, lower(trim(coalesce(name, ''))) FROM quote_areas WHERE quote_id = p_quote_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_old_ids FROM _rqfb_old_areas;

  INSERT INTO quote_areas (id, quote_id, name, sort_order)
  SELECT (a->>'id')::uuid, p_quote_id, a->>'name', coalesce((a->>'sort_order')::int, 0)
  FROM jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) a;

  -- Re-link labour rows: first by the area's previous id (survives renames)...
  UPDATE quote_items qi
  SET area_id = na.id
  FROM (SELECT (a->>'id')::uuid AS id, (a->>'old_id')::uuid AS old_id
        FROM jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) a
        WHERE a->>'old_id' IS NOT NULL) na
  WHERE qi.quote_id = p_quote_id
    AND qi.item_type = 'labour' AND qi.parent_item_id IS NULL
    AND qi.area_id = na.old_id;

  -- ...then fall back to name matching for rows without an old_id.
  UPDATE quote_items qi
  SET area_id = na.id
  FROM _rqfb_old_areas oa,
       (SELECT (a->>'id')::uuid AS id, lower(trim(coalesce(a->>'name', ''))) AS nm
        FROM jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) a) na
  WHERE qi.quote_id = p_quote_id
    AND qi.item_type = 'labour' AND qi.parent_item_id IS NULL
    AND qi.area_id = oa.id AND oa.nm = na.nm;

  DELETE FROM quote_items WHERE quote_id = p_quote_id AND item_type IS DISTINCT FROM 'labour';
  DELETE FROM quote_areas WHERE quote_id = p_quote_id AND id = ANY(v_old_ids);

  INSERT INTO quote_items (id, quote_id, area_id, parent_item_id, product_id, item_name, item_number,
    description, quantity, length, unit_price, total_price, is_bundle, item_type, metadata,
    sort_order, notes, source, supplier)
  SELECT r.id, p_quote_id, r.area_id, r.parent_item_id, r.product_id, r.item_name, r.item_number,
    r.description, r.quantity, r.length, r.unit_price, r.total_price, coalesce(r.is_bundle, false), r.item_type,
    coalesce(r.metadata, '{}'::jsonb), coalesce(r.sort_order, 0), r.notes, r.source, r.supplier
  FROM jsonb_populate_recordset(NULL::quote_items, coalesce(p_items, '[]'::jsonb)) r;

  UPDATE quotes SET subtotal = p_subtotal, vat_rate = p_vat_rate, vat_amount = p_vat_amount, total = p_total
  WHERE id = p_quote_id;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_quote_from_builder(uuid, jsonb, jsonb, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_quote_from_builder(uuid, jsonb, jsonb, numeric, numeric, numeric, numeric) TO authenticated;