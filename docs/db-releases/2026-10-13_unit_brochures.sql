-- Unit brochure pages /u/:modelKey?c=companyId (Johan approved 13 Oct 11:42). Additive only.
-- Rollback: docs/db-releases/2026-10-13_unit_brochures_rollback.sql
-- Public, anon-safe lookup: APPROVED product_media only (no product/support/source URLs, no prices) +
-- the sender company's public branding (default, non-archived company_profiles row). Unknown company => neutral.
CREATE OR REPLACE FUNCTION public.public_unit_brochure(p_model text, p_company uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_key text := public.normalize_model_code(p_model);
  m public.product_media%ROWTYPE;
  v_company jsonb := NULL;
  v_state text;
BEGIN
  IF v_key IS NOT NULL THEN
    SELECT * INTO m FROM public.product_media pm
     WHERE pm.model_key = v_key OR replace(pm.model_key, '/', '-') = v_key
     ORDER BY (pm.model_key = v_key) DESC LIMIT 1;
  END IF;
  v_state := CASE WHEN m.id IS NULL THEN 'not_found' WHEN m.status = 'approved' THEN 'approved' ELSE 'not_approved' END;

  IF p_company IS NOT NULL THEN
    SELECT jsonb_build_object(
             'company_id', c.id,
             'name', COALESCE(NULLIF(p.trading_name,''), NULLIF(p.legal_name,''), c.name),
             'legal_name', COALESCE(NULLIF(p.legal_name,''), c.name),
             'logo_url', COALESCE(NULLIF(p.logo_url,''), NULLIF(c.logo_url,'')),
             'phone', p.phone, 'email', p.email, 'website', p.website, 'whatsapp', p.whatsapp,
             'document_style', COALESCE(p.document_style, 'light'))
      INTO v_company
      FROM public.companies c
      LEFT JOIN LATERAL (SELECT * FROM public.company_profiles cp WHERE cp.company_id = c.id AND cp.archived_at IS NULL
                         ORDER BY cp.is_default DESC, cp.created_at LIMIT 1) p ON true
     WHERE c.id = p_company;
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'model_code', CASE WHEN m.id IS NULL THEN upper(coalesce(p_model,'')) ELSE m.model_code END,
    'brand', m.brand,
    'media', CASE WHEN v_state = 'approved' THEN jsonb_build_object(
        'model_key', m.model_key, 'model_code', m.model_code, 'brand', m.brand, 'family', m.family,
        'display_name', m.display_name, 'subtitle', m.subtitle,
        'image_url', CASE WHEN m.image_status = 'ready' THEN m.image_url END,
        'bullets', m.bullets, 'specs', m.specs, 'feature_highlight', m.feature_highlight) END,
    'company', v_company);
END $f$;
REVOKE ALL ON FUNCTION public.public_unit_brochure(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_unit_brochure(text, uuid) TO anon, authenticated;
