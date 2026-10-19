-- Website shop R-B (Johan 2026-10-19 06:26, "recommended defaults"): which catalogue unit the online shop sells per
-- room size and option, priced LIVE from the catalogue server-side. Costs/markup never leave the server: the public
-- functions return sell prices only, and only to service_role (the shop-prices / shop-checkout edge functions).
CREATE TABLE IF NOT EXISTS public.shop_tier_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  btu integer NOT NULL CHECK (btu IN (9000, 12000, 18000, 24000, 36000)),
  tier text NOT NULL CHECK (tier IN ('entry','inverter','windfree','other_budget','other_allergy','install','isolator')),
  product_id uuid NOT NULL REFERENCES public.supplier_products(id),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (company_id, btu, tier)
);
ALTER TABLE public.shop_tier_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_tier_map FROM PUBLIC, anon;
DROP POLICY IF EXISTS shop_tier_map_admin_read ON public.shop_tier_map;
CREATE POLICY shop_tier_map_admin_read ON public.shop_tier_map FOR SELECT TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id));

-- Sell price ex VAT of one catalogue item for a company (same rule as the quote builder: stored selling_price,
-- else cost x (1 + company units markup)). NULL = not sellable (inactive, archived, price on request, no price).
CREATE OR REPLACE FUNCTION public.fl_shop_sell_ex(p_company uuid, p_product uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE
           WHEN sp.id IS NULL OR NOT coalesce(sp.is_active, false) OR coalesce(sp.archived, false) OR coalesce(sp.is_price_on_request, false) THEN NULL
           WHEN coalesce(sp.selling_price, 0) > 0 THEN round(sp.selling_price, 2)
           WHEN coalesce(sp.cost_price, 0) > 0 THEN round(sp.cost_price * (1 + coalesce(c.units_markup_percent, 25) / 100.0), 2)
           ELSE NULL END
  FROM (SELECT 1) one
  LEFT JOIN public.supplier_products sp ON sp.id = p_product
  LEFT JOIN public.companies c ON c.id = p_company
$f$;

CREATE OR REPLACE FUNCTION public.fl_shop_size_btu(p_size text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE upper(coalesce(p_size, '')) WHEN 'S' THEN 9000 WHEN 'M' THEN 12000 WHEN 'L' THEN 18000 WHEN 'XL' THEN 24000 END
$f$;

-- Public-safe item description: "Samsung AR40 Inverter 12000 BTU" + up to 4 feature bullets from the catalogue.
CREATE OR REPLACE FUNCTION public.fl_shop_item_public(p_product uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT jsonb_build_object(
    'sku', sp.product_code,
    'name', trim(coalesce(nullif(sp.brand, ''), split_part(coalesce(sp.short_name, sp.name, ''), ' ', 1)) || ' ' ||
             coalesce(nullif(trim(split_part(coalesce(sp.description, ''), ' - ', 1)), ''), sp.short_name, sp.name, sp.product_code)),
    'features', coalesce((SELECT jsonb_agg(f) FROM (
        SELECT trim(x) f FROM unnest(string_to_array(substr(coalesce(sp.description, ''), nullif(position(' - ' in coalesce(sp.description, '')), 0) + 3), '•')) x
         WHERE position(' - ' in coalesce(sp.description, '')) > 0 AND length(trim(x)) BETWEEN 2 AND 60 AND position(' - ' in trim(x)) = 0 LIMIT 4) ff), '[]'::jsonb),
    'image_url', sp.image_url)
  FROM public.supplier_products sp WHERE sp.id = p_product
$f$;

-- The shop price list (public fields only). Options without a sellable unit, or sizes without an install price, are omitted.
CREATE OR REPLACE FUNCTION public.fl_shop_price_list(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_sizes jsonb := '[]'::jsonb; s record; v_inst numeric; v_iso numeric; v_opts jsonb; o record; v_ex numeric;
  v_inst_id uuid; v_iso_id uuid;
BEGIN
  FOR s IN SELECT * FROM (VALUES ('S','Small','up to 15 m²',9000,1),('M','Medium','16–24 m²',12000,2),('L','Large','25–35 m²',18000,3),('XL','X-Large','36–48 m²',24000,4)) v(size,label,m2,btu,ord) ORDER BY ord LOOP
    SELECT product_id INTO v_inst_id FROM public.shop_tier_map WHERE company_id = p_company AND btu = s.btu AND tier = 'install' AND active;
    v_inst := public.fl_shop_sell_ex(p_company, v_inst_id);
    CONTINUE WHEN v_inst IS NULL;
    SELECT product_id INTO v_iso_id FROM public.shop_tier_map WHERE company_id = p_company AND btu = s.btu AND tier = 'isolator' AND active;
    v_iso := CASE WHEN v_iso_id IS NULL THEN NULL ELSE public.fl_shop_sell_ex(p_company, v_iso_id) END;
    v_opts := '[]'::jsonb;
    FOR o IN SELECT m.tier, m.product_id FROM public.shop_tier_map m WHERE m.company_id = p_company AND m.btu = s.btu AND m.active
              AND m.tier IN ('entry','inverter','windfree','other_budget','other_allergy')
              ORDER BY array_position(ARRAY['entry','inverter','windfree','other_budget','other_allergy'], m.tier) LOOP
      v_ex := public.fl_shop_sell_ex(p_company, o.product_id);
      CONTINUE WHEN v_ex IS NULL;
      v_opts := v_opts || (jsonb_build_object('tier', o.tier, 'best_seller', o.tier = 'inverter',
        'unit_ex', v_ex, 'unit_incl', round(v_ex * 1.15, 2),
        'room_ex', v_ex + v_inst + coalesce(v_iso, 0), 'room_incl', round((v_ex + v_inst + coalesce(v_iso, 0)) * 1.15, 2))
        || coalesce(public.fl_shop_item_public(o.product_id), '{}'::jsonb));
    END LOOP;
    CONTINUE WHEN jsonb_array_length(v_opts) = 0;
    v_sizes := v_sizes || jsonb_build_object('size', s.size, 'label', s.label, 'm2', s.m2, 'btu', s.btu,
      'install', jsonb_build_object('name', 'Standard back-to-back installation (up to 3.5 m of piping)', 'ex', v_inst, 'incl', round(v_inst * 1.15, 2)),
      'isolator', CASE WHEN v_iso IS NULL THEN NULL ELSE jsonb_build_object('name', 'Electrical isolator point from the DB board (allowance, up to 15 m of cable)', 'ex', v_iso, 'incl', round(v_iso * 1.15, 2)) END,
      'options', v_opts);
  END LOOP;
  RETURN jsonb_build_object('currency', 'ZAR', 'vat_rate', 0.15, 'sizes', v_sizes, 'too_big', 'Rooms over 48 m²: talk to us for a free site visit.');
END $f$;

-- Server-side price of a cart. p_rooms = [{size:'S|M|L|XL', tier:'entry|inverter|windfree|other_budget|other_allergy', label?}], 1-8 rooms.
-- p_internal = true adds catalogue ids/costs for the order snapshot (only fl_shop_* functions use that; never returned to the website).
CREATE OR REPLACE FUNCTION public.fl_shop_quote(p_company uuid, p_rooms jsonb, p_internal boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r jsonb; i int := 0; v_btu int; v_tier text; v_label text; v_unit uuid; v_inst uuid; v_iso uuid;
  v_unit_ex numeric; v_inst_ex numeric; v_iso_ex numeric; v_lines jsonb := '[]'::jsonb; v_sub numeric := 0; v_line jsonb;
  v_size text;
BEGIN
  IF p_rooms IS NULL OR jsonb_typeof(p_rooms) <> 'array' OR jsonb_array_length(p_rooms) < 1 OR jsonb_array_length(p_rooms) > 8 THEN
    RAISE EXCEPTION 'shop: 1 to 8 rooms' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rooms) LOOP
    i := i + 1;
    v_size := upper(coalesce(r->>'size', ''));
    v_btu := public.fl_shop_size_btu(v_size);
    v_tier := lower(coalesce(r->>'tier', ''));
    v_label := nullif(left(trim(regexp_replace(coalesce(r->>'label', ''), '[<>]', '', 'g')), 60), '');
    IF v_btu IS NULL OR v_tier NOT IN ('entry','inverter','windfree','other_budget','other_allergy') THEN
      RAISE EXCEPTION 'shop: room % has an unknown size or option', i USING ERRCODE = '22023';
    END IF;
    SELECT product_id INTO v_unit FROM public.shop_tier_map WHERE company_id = p_company AND btu = v_btu AND tier = v_tier AND active;
    SELECT product_id INTO v_inst FROM public.shop_tier_map WHERE company_id = p_company AND btu = v_btu AND tier = 'install' AND active;
    v_iso := NULL;
    SELECT product_id INTO v_iso FROM public.shop_tier_map WHERE company_id = p_company AND btu = v_btu AND tier = 'isolator' AND active;
    v_unit_ex := public.fl_shop_sell_ex(p_company, v_unit);
    v_inst_ex := public.fl_shop_sell_ex(p_company, v_inst);
    v_iso_ex := CASE WHEN v_iso IS NULL THEN NULL ELSE public.fl_shop_sell_ex(p_company, v_iso) END;
    IF v_unit_ex IS NULL OR v_inst_ex IS NULL THEN
      RAISE EXCEPTION 'shop: room % option is not available', i USING ERRCODE = '22023';
    END IF;
    v_line := jsonb_build_object('room_no', i, 'label', coalesce(v_label, 'Room ' || i), 'size', v_size, 'btu', v_btu, 'tier', v_tier,
      'unit', public.fl_shop_item_public(v_unit) || jsonb_build_object('ex', v_unit_ex),
      'install', jsonb_build_object('name', 'Standard back-to-back installation (up to 3.5 m of piping)', 'ex', v_inst_ex),
      'isolator', CASE WHEN v_iso_ex IS NULL THEN NULL ELSE jsonb_build_object('name', 'Electrical isolator point from the DB board (allowance, up to 15 m of cable)', 'ex', v_iso_ex) END,
      'room_ex', v_unit_ex + v_inst_ex + coalesce(v_iso_ex, 0),
      'room_incl', round((v_unit_ex + v_inst_ex + coalesce(v_iso_ex, 0)) * 1.15, 2));
    IF p_internal THEN
      v_line := v_line || jsonb_build_object('internal', jsonb_build_object(
        'unit', (SELECT jsonb_build_object('product_id', sp.id, 'code', sp.product_code, 'short_name', coalesce(sp.short_name, sp.name), 'cost_ex', sp.cost_price, 'supplier_id', sp.supplier_id) FROM public.supplier_products sp WHERE sp.id = v_unit),
        'install', (SELECT jsonb_build_object('product_id', sp.id, 'code', sp.product_code, 'short_name', coalesce(sp.short_name, sp.name), 'cost_ex', sp.cost_price, 'supplier_id', sp.supplier_id) FROM public.supplier_products sp WHERE sp.id = v_inst),
        'isolator', (SELECT jsonb_build_object('product_id', sp.id, 'code', sp.product_code, 'short_name', coalesce(sp.short_name, sp.name), 'cost_ex', sp.cost_price, 'supplier_id', sp.supplier_id) FROM public.supplier_products sp WHERE sp.id = v_iso)));
    END IF;
    v_lines := v_lines || v_line;
    v_sub := v_sub + v_unit_ex + v_inst_ex + coalesce(v_iso_ex, 0);
  END LOOP;
  -- Same rounding as recalc_quote_totals, so the quote/invoice total equals what the client paid.
  RETURN jsonb_build_object('rooms', v_lines, 'subtotal_ex', round(v_sub, 2), 'vat', round(v_sub * 0.15, 2), 'total_incl', round(v_sub * 1.15, 2));
END $f$;

-- Owner/admin editor (Settings > Billing > Online shop models).
CREATE OR REPLACE FUNCTION public.fl_shop_tier_map_admin(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_admin(auth.uid(), p_company) THEN
    RAISE EXCEPTION 'Only a company admin can change the shop models' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('btu', m.btu, 'tier', m.tier, 'product_id', m.product_id, 'active', m.active,
              'code', sp.product_code, 'name', coalesce(sp.short_name, sp.name), 'description', left(sp.description, 80),
              'sell_incl', round(public.fl_shop_sell_ex(p_company, m.product_id) * 1.15, 2)) ORDER BY m.btu, m.tier)
            FROM public.shop_tier_map m LEFT JOIN public.supplier_products sp ON sp.id = m.product_id WHERE m.company_id = p_company), '[]'::jsonb),
    'candidates', coalesce((SELECT jsonb_agg(jsonb_build_object('product_id', sp.id, 'btu', coalesce(sp.capacity_btu, sp.btu_rating), 'code', sp.product_code,
              'name', coalesce(sp.short_name, sp.name), 'description', left(sp.description, 80),
              'sell_incl', round(public.fl_shop_sell_ex(p_company, sp.id) * 1.15, 2)) ORDER BY coalesce(sp.capacity_btu, sp.btu_rating), sp.selling_price)
            FROM public.supplier_products sp
           WHERE sp.is_active AND NOT coalesce(sp.archived, false) AND sp.category = 'Air Conditioning'
             AND coalesce(sp.capacity_btu, sp.btu_rating) IN (9000, 12000, 18000, 24000)
             AND coalesce(sp.short_name, sp.name, '') ~* '\mMW\M' AND public.fl_shop_sell_ex(p_company, sp.id) IS NOT NULL), '[]'::jsonb));
END $f$;

CREATE OR REPLACE FUNCTION public.fl_shop_tier_map_set(p_company uuid, p_btu integer, p_tier text, p_product uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_btu int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_admin(auth.uid(), p_company) THEN
    RAISE EXCEPTION 'Only a company admin can change the shop models' USING ERRCODE = '42501';
  END IF;
  IF p_tier NOT IN ('entry','inverter','windfree','other_budget','other_allergy') OR p_btu NOT IN (9000, 12000, 18000, 24000) THEN
    RAISE EXCEPTION 'Unknown size or option' USING ERRCODE = '22023';
  END IF;
  IF p_product IS NULL THEN
    DELETE FROM public.shop_tier_map WHERE company_id = p_company AND btu = p_btu AND tier = p_tier;
    RETURN;
  END IF;
  SELECT coalesce(capacity_btu, btu_rating) INTO v_btu FROM public.supplier_products WHERE id = p_product;
  IF v_btu IS DISTINCT FROM p_btu OR public.fl_shop_sell_ex(p_company, p_product) IS NULL THEN
    RAISE EXCEPTION 'That unit is not a priced % BTU unit', p_btu USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shop_tier_map (company_id, btu, tier, product_id, active, updated_at, updated_by)
  VALUES (p_company, p_btu, p_tier, p_product, true, now(), auth.uid())
  ON CONFLICT (company_id, btu, tier) DO UPDATE SET product_id = EXCLUDED.product_id, active = true, updated_at = now(), updated_by = auth.uid();
END $f$;

REVOKE ALL ON FUNCTION public.fl_shop_sell_ex(uuid, uuid), public.fl_shop_item_public(uuid), public.fl_shop_price_list(uuid),
  public.fl_shop_quote(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_shop_sell_ex(uuid, uuid), public.fl_shop_item_public(uuid), public.fl_shop_price_list(uuid),
  public.fl_shop_quote(uuid, jsonb, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fl_shop_tier_map_admin(uuid), public.fl_shop_tier_map_set(uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fl_shop_tier_map_admin(uuid), public.fl_shop_tier_map_set(uuid, integer, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fl_shop_size_btu(text) TO authenticated, service_role;

-- Seed Massair CT defaults (D2: Entry AR3000 / Best seller AR40 / Premium WindFree AR6500; other needs: Midea inverter, WindFree AR9500 at 18K/24K;
-- fixed install prices; D3: 24K isolator allowance as its own line). Matched by product code; nothing is seeded if a code is missing.
INSERT INTO public.shop_tier_map (company_id, btu, tier, product_id)
SELECT '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid, v.btu, v.tier, p.id
FROM (VALUES
  (9000,'entry','AR09CQHGAWK/FA'), (12000,'entry','AR12CQHGAWK/FA'), (18000,'entry','AR18CQHGAWK/FA'), (24000,'entry','AR24CQHGAWK/FA'),
  (9000,'inverter','AR40F09C0AG/FA'), (12000,'inverter','AR40F12C0AG/FA'), (18000,'inverter','AR40F18C0AG/FA'), (24000,'inverter','AR40F24C0AG/FA'),
  (9000,'windfree','AR09BSHCMWK/FA'), (12000,'windfree','AR12BSHCMWK/FA'), (18000,'windfree','AR18BSHCMWK/FA'), (24000,'windfree','AR24BSHCMWK/FA'),
  (9000,'other_budget','INVEXT-09-R32'), (12000,'other_budget','INVEXT-12-R32'), (18000,'other_budget','INVEXT-18-R32'), (24000,'other_budget','INVEXT-24-R32'),
  (18000,'other_allergy','AR18BSAAAWK/FA'), (24000,'other_allergy','AR24BSAAAWK/FA')
) v(btu, tier, code)
CROSS JOIN LATERAL (SELECT sp.id FROM public.supplier_products sp
   WHERE sp.product_code = v.code AND sp.is_active AND NOT coalesce(sp.archived, false) AND coalesce(sp.capacity_btu, sp.btu_rating) = v.btu
   ORDER BY sp.updated_at DESC NULLS LAST LIMIT 1) p
ON CONFLICT (company_id, btu, tier) DO NOTHING;

INSERT INTO public.shop_tier_map (company_id, btu, tier, product_id)
SELECT '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid, v.btu, v.tier, sp.id
FROM (VALUES (9000,'install','STD-B2B-INST-09-12K'), (12000,'install','STD-B2B-INST-09-12K'), (18000,'install','STD-B2B-INST-18-24K'),
             (24000,'install','STD-B2B-INST-18-24K'), (36000,'install','STD-B2B-INST-36K'), (24000,'isolator','ELEC-ISO-DB-ALLOW')) v(btu, tier, code)
JOIN public.supplier_products sp ON sp.product_code = v.code AND sp.supplier_id = '8d752820-fe99-4a37-b980-d93311db25b7' AND sp.is_active
ON CONFLICT (company_id, btu, tier) DO NOTHING;
