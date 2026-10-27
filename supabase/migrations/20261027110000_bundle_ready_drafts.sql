-- 27 Oct 2026 (Johan): ready drafts may be sent together. A draft is blocked only if it has no client or no lines;
-- the R0 price check runs in the app (assertQuotePriced, same as single Send), which then marks each draft sent.
-- Rollback: supabase/rollbacks/20261027110000_bundle_ready_drafts_rollback.sql
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
         string_agg(coalesce(quote_number,'Draft'), ', ') FILTER (WHERE status = 'draft' AND (customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM quote_items qi WHERE qi.quote_id = quotes.id AND qi.parent_item_id IS NULL)))
    INTO v_n, v_cust, v_cid, v_bad FROM quotes WHERE id = ANY(v_ids) AND company_id = v_co;
  IF v_n <> array_length(v_ids,1) THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Not ready: % (need a client and lines). Finish those, or send them one by one.', v_bad; END IF;
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
