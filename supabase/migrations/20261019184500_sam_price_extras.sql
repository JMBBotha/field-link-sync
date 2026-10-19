-- Sam (AI sales voice agent) private price extras (Johan 2026-10-19 18:29 "Do it all ... private pipe/labour").
-- Selling prices only (catalogue sell via fl_shop_sell_ex, the shop's rule); cost, markup and supplier never leave the DB.
-- Gated by a shared secret: the caller sends p_key; only its SHA-256 is stored here (the key itself lives only in the
-- Fly secret SAM_PRICE_KEY on massair-mandy-voice). Wrong/missing key -> 42501. Massair CT (361bf031) only. Read-only.
CREATE OR REPLACE FUNCTION public.fl_sam_price_extras(p_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  c constant uuid := '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
  v_kits jsonb; v_trunk numeric; v_iso numeric; v_iso_name text; v_rate numeric; v_hours numeric;
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 OR encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> '88a5f97ec98520936cc14f605d25dacd3c885b3a8910c789e7a9a0d38b13b1e6' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  -- Per-metre SELL of each standard-install piping kit (same maths as the quote builder's per-metre kit:
  -- length parts = sell / unit_length x metres per kit metre; count parts = piece sell x qty per kit metre).
  SELECT coalesce(jsonb_agg(jsonb_build_object('name', k.name, 'btu_min', k.min_btu, 'btu_max', k.max_btu, 'per_metre_ex', round(k.per_m, 4)) ORDER BY k.min_btu), '[]'::jsonb)
    INTO v_kits
  FROM (
    SELECT ib.name, ib.min_btu, ib.max_btu,
      sum(CASE WHEN bi.is_length_item AND coalesce(sp.price_per_metre, 0) > 0
               THEN public.fl_shop_sell_ex(c, sp.id) / coalesce(nullif(sp.unit_length, 0), 1) * coalesce(bi.length_metres, bi.quantity, 1)
               ELSE public.fl_shop_sell_ex(c, sp.id) / greatest(coalesce(nullif(sp.price_per_unit_qty, 0), nullif(sp.pack_qty, 0), 1), 1) * coalesce(bi.length_metres, bi.quantity, 1) END) AS per_m,
      bool_and(public.fl_shop_sell_ex(c, sp.id) IS NOT NULL) AS ok
    FROM public.installation_bundles ib
    JOIN public.bundle_items bi ON bi.bundle_id = ib.id AND NOT coalesce(bi.is_optional, false)
    JOIN public.supplier_products sp ON sp.id = bi.supplier_product_id
    WHERE ib.is_active AND ib.id IN (SELECT bundle_id FROM public.install_template_items WHERE role = 'piping_kit' AND included AND bundle_id IS NOT NULL)
    GROUP BY ib.id, ib.name, ib.min_btu, ib.max_btu
  ) k WHERE k.ok AND k.per_m > 0;
  -- Main trunking (TRUNK01 100x40) sell per metre, for pipe beyond the standard run.
  SELECT public.fl_shop_sell_ex(c, sp.id) / coalesce(nullif(sp.unit_length, 0), 1) INTO v_trunk
    FROM public.supplier_products sp WHERE sp.product_code = 'TRUNK01' AND sp.is_active AND NOT coalesce(sp.archived, false)
    ORDER BY sp.updated_at DESC NULLS LAST LIMIT 1;
  -- Isolator / electrical allowance (the shop's 24K isolator line).
  SELECT public.fl_shop_sell_ex(c, m.product_id), 'Electrical isolator point from the DB board (allowance, up to 15 m of cable)' INTO v_iso, v_iso_name
    FROM public.shop_tier_map m WHERE m.company_id = c AND m.tier = 'isolator' AND m.active ORDER BY m.btu LIMIT 1;
  SELECT cs.default_hourly_rate, cs.default_install_labour_hours INTO v_rate, v_hours FROM public.company_settings cs WHERE cs.company_id = c LIMIT 1;
  RETURN jsonb_build_object('company', '0800-BE-COOL', 'vat_rate', 0.15, 'standard_pipe_m', 3.5,
    'kits', v_kits, 'trunking_per_metre_ex', round(v_trunk, 4),
    'labour', jsonb_build_object('hourly_rate_ex', v_rate, 'install_labour_hours', v_hours),
    'items', jsonb_build_object('isolator', CASE WHEN v_iso IS NULL THEN NULL ELSE jsonb_build_object('name', v_iso_name, 'ex', v_iso) END),
    'generated_at', now());
END $f$;
REVOKE ALL ON FUNCTION public.fl_sam_price_extras(text) FROM PUBLIC, authenticated;
-- anon may call it (PostgREST RPC from the Fly server with the public anon key); without the shared secret it raises.
GRANT EXECUTE ON FUNCTION public.fl_sam_price_extras(text) TO anon, service_role;
