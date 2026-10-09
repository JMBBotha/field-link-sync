-- Tech catalogue lockdown (Johan 01:53). Techs never receive sell/cost/markup from the server.
-- 1) Safe tech catalogue: id, name, model, category, unit, length only.
CREATE OR REPLACE FUNCTION public.get_tech_catalogue()
RETURNS TABLE(id uuid, name text, model text, category text, unit text, length numeric, length_unit text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT sp.id,
         COALESCE(NULLIF(trim(sp.short_name),''), NULLIF(trim(sp.name),''), sp.description) AS name,
         COALESCE(NULLIF(trim(sp.model),''), sp.product_code) AS model,
         COALESCE(NULLIF(sp.product_category,''), sp.category) AS category,
         sp.unit_type AS unit,
         CASE WHEN COALESCE(sp.sold_in_length,false) THEN sp.unit_length END AS length,
         CASE WHEN COALESCE(sp.sold_in_length,false) THEN sp.unit_length_unit END AS length_unit
  FROM public.supplier_products sp
  WHERE sp.is_active = true AND NOT COALESCE(sp.archived,false)
    AND EXISTS (SELECT 1 FROM public.pdf_uploads pu WHERE pu.id = sp.pdf_upload_id AND pu.is_active)
    AND auth.uid() IS NOT NULL AND public.can_read_master_catalog(auth.uid())
  ORDER BY COALESCE(sp.is_pinned,false) DESC, 2;
$$;
REVOKE ALL ON FUNCTION public.get_tech_catalogue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tech_catalogue() TO authenticated;

-- 2) The priced picker returns nothing to field techs (office/sales unchanged; service role unchanged).
CREATE OR REPLACE FUNCTION public.get_product_sell_options()
 RETURNS TABLE(id uuid, product_code text, short_name text, description text, category text, is_pinned boolean, sell_excl_vat numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT sp.id, sp.product_code, sp.short_name, sp.description, sp.category, sp.is_pinned, sp.cost_price,
           CASE WHEN sp.default_markup_percent IS NOT NULL AND sp.default_markup_percent <> 0 THEN sp.default_markup_percent
                WHEN sp.markup_percent IS NOT NULL AND sp.markup_percent <> 0 THEN sp.markup_percent
                ELSE NULL END AS raw_mk
    FROM public.supplier_products sp
    WHERE sp.is_active = true AND NOT coalesce(sp.archived, false) AND EXISTS (SELECT 1 FROM public.pdf_uploads pu WHERE pu.id = sp.pdf_upload_id AND pu.is_active) /*live_book_only*/ AND auth.uid() IS NOT NULL AND public.can_read_master_catalog(auth.uid()) AND NOT public.is_field_tech_only(auth.uid()) /*tech_no_prices*/
  ), m AS (
    SELECT p.*, LEAST(GREATEST(CASE WHEN raw_mk IS NULL THEN 35
                                    WHEN raw_mk > 0 AND raw_mk <= 1 THEN round(raw_mk * 100, 2)
                                    WHEN raw_mk <= 0 THEN 35
                                    ELSE raw_mk END, -50), 500) AS mk
    FROM p
  )
  SELECT m.id, m.product_code, m.short_name, m.description, m.category, COALESCE(m.is_pinned, false),
         round(LEAST(GREATEST(COALESCE(m.cost_price, 0), 0), 10000000) * (1 + m.mk / 100), 2)
  FROM m
  ORDER BY COALESCE(m.is_pinned, false) DESC, m.description;
$function$;

-- 3) supplier_products / pdf_uploads / inventory_items already have RESTRICTIVE tech_lockdown_select (techs read 0 rows);
--    search_supplier_products, link_products_to_pdf_book and activate_pdf_book_gate already refuse techs. No change.
