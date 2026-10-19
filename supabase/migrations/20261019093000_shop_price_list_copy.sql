-- Website shop copy fix (2026-10-19): fl_shop_price_list said "free site visit" for rooms over 48 m², an unverified claim.
-- Replaces only that string in the live function body. Rollback: docs/db-releases/2026-10-19_shop_price_list_copy_rollback.sql
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fl_shop_price_list(uuid)'::regprocedure);
  IF position('talk to us for a free site visit.' in d) > 0 THEN
    EXECUTE replace(d, 'talk to us for a free site visit.', 'talk to us and we''''ll quote for your space.');
  END IF;
END $do$;
REVOKE ALL ON FUNCTION public.fl_shop_price_list(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_shop_price_list(uuid) TO service_role;
