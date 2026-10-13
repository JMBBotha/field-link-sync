-- Rollback for 20261013150000_quote_bundles.sql
DROP FUNCTION IF EXISTS public.public_quote_bundle(uuid);
DROP FUNCTION IF EXISTS public.create_quote_bundle(uuid[], jsonb);
DROP FUNCTION IF EXISTS public.quote_bundle_preview(uuid[]);
DROP FUNCTION IF EXISTS public.quote_auto_summary(uuid);
DROP TABLE IF EXISTS public.quote_bundles;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS client_summary;
-- previous HEAD before this release: d9b21446ff83809015b881e0702ea6ea773dae4f (revert the release commit to roll back code)
