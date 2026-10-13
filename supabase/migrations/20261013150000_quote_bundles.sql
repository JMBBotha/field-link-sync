-- Send several quotes together (Johan 2026-10-13 14:58). Additive only.
-- Rollback: docs/db-releases/2026-10-13_quote_bundles_rollback.sql
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS client_summary text;

CREATE TABLE IF NOT EXISTS public.quote_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  quote_ids uuid[] NOT NULL,
  created_by uuid,
  sent_to text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_bundles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qb_select_company ON public.quote_bundles;
CREATE POLICY qb_select_company ON public.quote_bundles FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

-- One-line client description from the quote's units:
-- "3 units: 2x Samsung 12k midwall (bedrooms) + 1x Daikin 24k cassette (lounge)"
CREATE OR REPLACE FUNCTION public.quote_auto_summary(p_quote_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; parts text[] := '{}'; n numeric := 0; v_title text;
BEGIN
  FOR r IN
    WITH u AS (
      SELECT qi.quantity, qa.name AS area, qa.sort_order, qi.sort_order AS so, qi.item_name, qi.metadata AS md
      FROM quote_items qi LEFT JOIN quote_areas qa ON qa.id = qi.area_id
      WHERE qi.quote_id = p_quote_id AND qi.parent_item_id IS NULL AND coalesce(qi.quantity,0) > 0
        AND coalesce(qi.item_type,'') NOT IN ('labour','service','material','materials')
        AND (coalesce((qi.metadata->>'is_unit')::boolean,false)
             OR (qi.item_name ~* '\m\d{1,2}\s*k(\s*btu)?\M|\d{4,5}\s*btu' AND qi.item_name !~* 'install|material|kit|labour|pipe|bracket|regas'))
    ), d AS (
      SELECT quantity, area, sort_order, so,
        CASE WHEN lower(coalesce(nullif(md->>'brand',''), (regexp_match(item_name, '\m(samsung|daikin|midea|lg|mitsubishi|carrier|alliance|gree|hisense|toshiba|panasonic|fujitsu|comfee|aux|tcl|york|sinclair|tecnosystemi)\M', 'i'))[1])) = 'lg' THEN 'LG'
          ELSE initcap(coalesce(nullif(md->>'brand',''), (regexp_match(item_name, '\m(samsung|daikin|midea|lg|mitsubishi|carrier|alliance|gree|hisense|toshiba|panasonic|fujitsu|comfee|aux|tcl|york|sinclair|tecnosystemi)\M', 'i'))[1])) END AS brand,
        coalesce(
          CASE WHEN (md->>'capacity_btu') ~ '^\d+$' THEN round((md->>'capacity_btu')::numeric/1000)::text || 'k' END,
          (regexp_match(item_name, '\m(\d{1,2})\s*k(\s*btu)?\M', 'i'))[1]::int::text || 'k',
          round((regexp_match(item_name, '(\d{4,5})\s*BTU', 'i'))[1]::numeric/1000)::text || 'k') AS btu,
        CASE
          WHEN item_name ~* 'cassette|\mcass' THEN 'cassette'
          WHEN item_name ~* 'duct' THEN 'ducted'
          WHEN item_name ~* 'floor|console' THEN 'floor-standing'
          WHEN item_name ~* 'under.?ceiling|ceiling' THEN 'under-ceiling'
          WHEN item_name ~* 'portable' THEN 'portable'
          WHEN item_name ~* 'multi' THEN 'multi-split'
          WHEN item_name ~* 'mid.?wall|wall|split|\mmw\M|\minv\M|non-inv' THEN 'midwall'
          ELSE NULL END AS kind
      FROM u
    )
    SELECT sum(quantity) q, brand, btu, kind,
           string_agg(DISTINCT lower(area), ', ') areas, min(coalesce(sort_order,999)*1000+coalesce(so,0)) o
    FROM d GROUP BY brand, btu, kind ORDER BY o
  LOOP
    n := n + r.q;
    parts := parts || (trim(to_char(r.q,'FM999990.##')) || 'x ' ||
      btrim(concat_ws(' ', nullif(r.brand,''), r.btu, r.kind)) ||
      coalesce(' (' || r.areas || ')', ''));
  END LOOP;
  IF n > 0 THEN
    RETURN trim(to_char(n,'FM999990.##')) || CASE WHEN n = 1 THEN ' unit: ' ELSE ' units: ' END || array_to_string(parts, ' + ');
  END IF;
  SELECT coalesce(nullif(btrim(qi.item_name),''), '') INTO v_title FROM quote_items qi
   WHERE qi.quote_id = p_quote_id AND qi.parent_item_id IS NULL ORDER BY qi.sort_order NULLS LAST, qi.created_at LIMIT 1;
  RETURN nullif(v_title,'');
END $$;
REVOKE ALL ON FUNCTION public.quote_auto_summary(uuid) FROM PUBLIC, anon, authenticated;

-- Staff: preview rows for the Send-together dialog (own company only).
CREATE OR REPLACE FUNCTION public.quote_bundle_preview(p_quote_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'quote_number', q.quote_number, 'status', q.status, 'customer_id', q.customer_id,
    'customer_name', q.customer_name, 'total', q.total, 'valid_until', q.valid_until,
    'client_summary', q.client_summary, 'auto_summary', public.quote_auto_summary(q.id)) ORDER BY q.created_at), '[]'::jsonb)
  FROM quotes q WHERE q.id = ANY(p_quote_ids) AND q.company_id = public.get_user_company_id(auth.uid())
$$;
GRANT EXECUTE ON FUNCTION public.quote_bundle_preview(uuid[]) TO authenticated;

-- Staff: create the bundle. Same people who may send a quote; same client; no drafts.
CREATE OR REPLACE FUNCTION public.create_quote_bundle(p_quote_ids uuid[], p_summaries jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_co uuid := public.get_user_company_id(auth.uid());
  v_ids uuid[]; v_n int; v_cust int; v_cid uuid; v_bad text; v_tok uuid; v_owner boolean; v_admin boolean; v_rep boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_quote_ids) x;
  IF coalesce(array_length(v_ids,1),0) < 2 THEN RAISE EXCEPTION 'Pick at least two quotes'; END IF;
  IF array_length(v_ids,1) > 20 THEN RAISE EXCEPTION 'At most 20 quotes at once'; END IF;
  SELECT count(*), count(DISTINCT customer_id), min(customer_id::text)::uuid,
         string_agg(quote_number, ', ') FILTER (WHERE status = 'draft')
    INTO v_n, v_cust, v_cid, v_bad FROM quotes WHERE id = ANY(v_ids) AND company_id = v_co;
  IF v_n <> array_length(v_ids,1) THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Drafts cannot be sent together (%). Finish them first.', v_bad; END IF;
  IF v_cust <> 1 OR v_cid IS NULL OR EXISTS (SELECT 1 FROM quotes WHERE id = ANY(v_ids) AND customer_id IS NULL) THEN
    RAISE EXCEPTION 'All quotes must be for the same client';
  END IF;
  v_owner := coalesce(public.is_company_owner(v_uid, v_co), false);
  v_admin := public.has_role(v_uid, 'admin') OR EXISTS (SELECT 1 FROM company_members WHERE user_id = v_uid AND company_id = v_co AND role = 'admin');
  v_rep := public.is_sales_rep(v_uid);
  IF NOT (v_owner OR v_admin OR (public.has_role(v_uid, 'dispatcher') AND NOT v_rep)
          OR (v_rep AND NOT EXISTS (SELECT 1 FROM quotes WHERE id = ANY(v_ids) AND v_uid NOT IN (coalesce(created_by,'00000000-0000-0000-0000-000000000000'), coalesce(owner_id,'00000000-0000-0000-0000-000000000000'), coalesce(sales_engineer_id,'00000000-0000-0000-0000-000000000000'))))) THEN
    RAISE EXCEPTION 'You are not allowed to send these quotes';
  END IF;
  UPDATE quotes q SET public_token = coalesce(q.public_token, gen_random_uuid()),
    client_summary = CASE WHEN p_summaries ? q.id::text THEN nullif(left(btrim(p_summaries->>q.id::text),200),'') ELSE q.client_summary END
   WHERE q.id = ANY(v_ids);
  INSERT INTO quote_bundles (company_id, customer_id, quote_ids, created_by) VALUES (v_co, v_cid, v_ids, v_uid) RETURNING token INTO v_tok;
  RETURN jsonb_build_object('token', v_tok);
END $$;
GRANT EXECUTE ON FUNCTION public.create_quote_bundle(uuid[], jsonb) TO authenticated;

-- Public all-quotes page (token-gated, that bundle's quotes only).
CREATE OR REPLACE FUNCTION public.public_quote_bundle(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'customer_name', (SELECT coalesce(c.name, c.company_name) FROM customers c WHERE c.id = b.customer_id),
    'company_name', coalesce((SELECT coalesce(cp.legal_name, cp.trading_name) FROM company_profiles cp WHERE cp.company_id = b.company_id AND cp.archived_at IS NULL ORDER BY cp.is_default DESC, cp.created_at LIMIT 1),
                             (SELECT cs.company_name FROM company_settings cs WHERE cs.company_id = b.company_id ORDER BY cs.is_primary DESC LIMIT 1)),
    'logo_url', (SELECT cp.logo_url FROM company_profiles cp WHERE cp.company_id = b.company_id AND cp.archived_at IS NULL ORDER BY cp.is_default DESC, cp.created_at LIMIT 1),
    'phone', (SELECT cp.phone FROM company_profiles cp WHERE cp.company_id = b.company_id AND cp.archived_at IS NULL ORDER BY cp.is_default DESC, cp.created_at LIMIT 1),
    'quotes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'quote_number', q.quote_number, 'summary', coalesce(nullif(q.client_summary,''), public.quote_auto_summary(q.id)),
        'total', q.total, 'valid_until', q.valid_until, 'status', q.status, 'token', q.public_token,
        'changes_open', EXISTS (SELECT 1 FROM quote_change_requests r WHERE r.quote_id = q.id AND r.status = 'open'))
        ORDER BY array_position(b.quote_ids, q.id)), '[]'::jsonb)
      FROM quotes q WHERE q.id = ANY(b.quote_ids) AND q.company_id = b.company_id AND q.status <> 'draft'))
  FROM quote_bundles b WHERE b.token = p_token
$$;
GRANT EXECUTE ON FUNCTION public.public_quote_bundle(uuid) TO anon, authenticated;
