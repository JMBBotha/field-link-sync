-- OSS in-house items + internal SKUs (2026-10-09). Additive only; idempotent.
CREATE TABLE IF NOT EXISTS public.internal_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code text NOT NULL UNIQUE CHECK (sku_code ~ '^[A-Z0-9]+(-[A-Z0-9._]+)*$' AND length(sku_code) <= 48),
  family text NOT NULL,
  type_code text,
  size_code text,
  variant text,
  name text NOT NULL,
  category text,
  unit text NOT NULL DEFAULT 'each' CHECK (unit IN ('each','metre')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.supplier_sku_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES public.internal_skus(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  supplier_code text,
  supplier_product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('in_house','manual','auto')),
  active_from date NOT NULL DEFAULT current_date,
  active_to date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_sku_map_open_code ON public.supplier_sku_map (supplier_id, supplier_code) WHERE active_to IS NULL AND supplier_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_sku_map_open_product ON public.supplier_sku_map (supplier_product_id) WHERE active_to IS NULL AND supplier_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_sku_map_sku ON public.supplier_sku_map (sku_id);

ALTER TABLE public.internal_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_sku_map ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='internal_skus' AND policyname='Master catalogue read') THEN
    CREATE POLICY "Master catalogue read" ON public.internal_skus FOR SELECT TO authenticated USING (can_read_master_catalog(auth.uid()));
    CREATE POLICY "Master catalogue insert" ON public.internal_skus FOR INSERT TO authenticated WITH CHECK (can_write_master_catalog(auth.uid()));
    CREATE POLICY "Master catalogue update" ON public.internal_skus FOR UPDATE TO authenticated USING (can_write_master_catalog(auth.uid())) WITH CHECK (can_write_master_catalog(auth.uid()));
    CREATE POLICY "Master catalogue read" ON public.supplier_sku_map FOR SELECT TO authenticated USING (can_read_master_catalog(auth.uid()));
    CREATE POLICY "Master catalogue insert" ON public.supplier_sku_map FOR INSERT TO authenticated WITH CHECK (can_write_master_catalog(auth.uid()));
    CREATE POLICY "Master catalogue update" ON public.supplier_sku_map FOR UPDATE TO authenticated USING (can_write_master_catalog(auth.uid())) WITH CHECK (can_write_master_catalog(auth.uid()));
  END IF;
END $$;
-- No DELETE policies: archive (is_active=false / active_to) instead.
GRANT SELECT, INSERT, UPDATE ON public.internal_skus, public.supplier_sku_map TO authenticated;
GRANT ALL ON public.internal_skus, public.supplier_sku_map TO service_role;

-- One transaction: new in-house book + pages + items (+SKUs), old in-house book off. SECURITY INVOKER => caller's RLS applies.
CREATE OR REPLACE FUNCTION public.publish_inhouse_book(
  p_supplier_id uuid, p_file_name text, p_pdf_url text, p_storage_path text, p_pages jsonb, p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_upload uuid; v_item jsonb; v_pid uuid; v_sku uuid; v_cost numeric; v_len numeric; v_metre boolean;
  v_code text; v_missing int; v_ids uuid[] := '{}';
BEGIN
  IF NOT can_write_master_catalog(auth.uid()) THEN
    RAISE EXCEPTION 'Only master-catalogue admins can change in-house items' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND supplier_type = 'consumables') THEN
    RAISE EXCEPTION 'In-house items can only be added to a consumables supplier (One Stop Shop)';
  END IF;
  IF jsonb_typeof(p_pages) <> 'array' OR jsonb_array_length(p_pages) = 0 THEN RAISE EXCEPTION 'No pages'; END IF;

  -- every live in-house item must be on the new book (otherwise it would silently drop off the live list)
  SELECT array_agg((x->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_items) x WHERE nullif(x->>'id','') IS NOT NULL;
  SELECT count(*) INTO v_missing FROM supplier_products sp
   WHERE sp.supplier_id = p_supplier_id AND sp.import_flags @> ARRAY['in_house'] AND NOT coalesce(sp.archived,false)
     AND NOT (sp.id = ANY (coalesce(v_ids, '{}')));
  IF v_missing > 0 THEN RAISE EXCEPTION 'Stale item list (% live in-house items missing) - reload and try again', v_missing; END IF;

  INSERT INTO pdf_uploads (supplier_id, file_name, file_path, storage_path, file_url, status, page_count, price_list_type,
                           brand, is_active, markup_percent, price_includes_vat)
  VALUES (p_supplier_id, p_file_name, p_storage_path, p_storage_path, p_pdf_url, 'parsed', jsonb_array_length(p_pages),
          'in_house', 'In-house', false, 100, false)
  RETURNING id INTO v_upload;

  INSERT INTO supplier_pdf_pages (supplier_id, pdf_filename, page_number, page_image_url, pdf_storage_path, price_column_bbox, brand, pdf_upload_id)
  SELECT p_supplier_id::text, p_file_name, (pg->>'page_number')::int, pg->>'page_image_url', p_pdf_url,
         pg->'price_column_bbox', 'In-house', v_upload
    FROM jsonb_array_elements(p_pages) pg;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := nullif(v_item->>'id','')::uuid;
    IF coalesce((v_item->>'archived')::boolean, false) THEN
      IF v_pid IS NULL THEN CONTINUE; END IF;
      UPDATE supplier_products SET archived = true, is_active = false, archived_at = coalesce(archived_at, now()), updated_at = now()
       WHERE id = v_pid AND supplier_id = p_supplier_id AND import_flags @> ARRAY['in_house'];
      UPDATE supplier_sku_map SET active_to = current_date WHERE supplier_product_id = v_pid AND active_to IS NULL;
      CONTINUE;
    END IF;

    v_code := v_item->>'sku_code';
    v_cost := round((v_item->>'cost')::numeric, 2);
    v_metre := coalesce((v_item->>'per_metre')::boolean, false);
    v_len := nullif(v_item->>'unit_length','')::numeric;
    IF v_code IS NULL OR v_code !~ '^[A-Z0-9]+(-[A-Z0-9._]+)*$' THEN RAISE EXCEPTION 'Bad SKU %', v_code; END IF;
    IF v_cost IS NULL OR v_cost <= 0 THEN RAISE EXCEPTION 'Cost must be above 0 for %', v_code; END IF;
    IF v_metre AND (v_len IS NULL OR v_len <= 0) THEN RAISE EXCEPTION 'Coil length needed for per-metre item %', v_code; END IF;

    INSERT INTO internal_skus (sku_code, family, type_code, size_code, variant, name, category, unit)
    VALUES (v_code, v_item->>'family', v_item->>'type_code', v_item->>'size_code', nullif(v_item->>'variant',''),
            v_item->>'name', v_item->>'category', CASE WHEN v_metre THEN 'metre' ELSE 'each' END)
    ON CONFLICT (sku_code) DO UPDATE SET name = excluded.name, category = excluded.category, unit = excluded.unit,
      family = excluded.family, type_code = excluded.type_code, size_code = excluded.size_code, variant = excluded.variant,
      is_active = true, updated_at = now()
    RETURNING id INTO v_sku;

    IF v_pid IS NULL THEN
      INSERT INTO supplier_products (supplier_id, product_code, description, import_flags, pdf_upload_id, archived, is_active)
      VALUES (p_supplier_id, v_code, coalesce(nullif(v_item->>'description',''), v_item->>'name', v_code), ARRAY['in_house'], v_upload, true, false)
      RETURNING id INTO v_pid;
    END IF;

    UPDATE supplier_products SET
      product_code = v_code, name = v_item->>'name', short_name = v_item->>'name', description = coalesce(nullif(v_item->>'description',''), v_item->>'name'),
      category = v_item->>'category', subcategory = 'In-house', product_category = 'Consumables', brand = 'One Stop Shop',
      product_type = 'ac_unit', pricing_mode = 'per-unit', vat_rate = 15, price_includes_vat = false,
      cost_price = v_cost, cost_excl_vat = v_cost, list_price_raw = v_cost, original_cost_excl_vat = v_cost,
      cost_incl_vat = round(v_cost * 1.15, 2), supplier_discount_percent = 0,
      default_markup_percent = 100, markup_percent = 100, -- selling_price is generated (cost x (1+markup))
      sold_in_length = v_metre, unit_length = CASE WHEN v_metre THEN v_len END, unit_length_unit = 'm',
      price_per_metre = CASE WHEN v_metre THEN round(v_cost / v_len, 2) END, min_cut_length = 0.5,
      price_per_unit_qty = 1, price_per_unit_label = CASE WHEN v_metre THEN 'm' ELSE 'each' END,
      allows_decimal_qty = v_metre, qty_step = CASE WHEN v_metre THEN 0.1 ELSE 1 END, min_qty = CASE WHEN v_metre THEN 0 ELSE 1 END,
      import_flags = ARRAY['in_house'], import_confidence = 'in_house',
      pdf_upload_id = v_upload, page_number = (v_item->>'page_number')::int, row_bbox = v_item->'row_bbox', price_bbox = v_item->'price_bbox',
      archived = false, archived_at = NULL, is_active = true, updated_at = now()
    WHERE id = v_pid AND supplier_id = p_supplier_id AND import_flags @> ARRAY['in_house'];
    IF NOT FOUND THEN RAISE EXCEPTION 'Item % is not an in-house item of this supplier', v_pid; END IF;

    UPDATE supplier_sku_map SET active_to = current_date WHERE supplier_product_id = v_pid AND active_to IS NULL AND sku_id <> v_sku;
    INSERT INTO supplier_sku_map (sku_id, supplier_id, supplier_code, supplier_product_id, source)
    SELECT v_sku, p_supplier_id, NULL, v_pid, 'in_house'
     WHERE NOT EXISTS (SELECT 1 FROM supplier_sku_map WHERE supplier_product_id = v_pid AND active_to IS NULL);
  END LOOP;

  UPDATE pdf_uploads SET is_active = false, status = 'archived', updated_at = now()
   WHERE supplier_id = p_supplier_id AND price_list_type = 'in_house' AND id <> v_upload AND is_active;
  UPDATE pdf_uploads SET is_active = true, activated_at = now(), updated_at = now() WHERE id = v_upload;
  RETURN v_upload;
END $fn$;
REVOKE ALL ON FUNCTION public.publish_inhouse_book(uuid, text, text, text, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publish_inhouse_book(uuid, text, text, text, jsonb, jsonb) TO authenticated;
