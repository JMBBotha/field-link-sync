-- Rollback for 20261019093000_shop_price_list_copy.sql (restores the previous too_big wording).
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fl_shop_price_list(uuid)'::regprocedure);
  EXECUTE replace(d, 'talk to us and we''''ll quote for your space.', 'talk to us for a free site visit.');
END $do$;
REVOKE ALL ON FUNCTION public.fl_shop_price_list(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_shop_price_list(uuid) TO service_role;
