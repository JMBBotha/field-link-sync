-- Rollback for 20261019184500_sam_price_extras.sql (Sam private price extras). Nothing else depends on it in the DB;
-- Sam's server falls back to "priced in the written quote" for extra pipe/labour when the RPC is gone.
DROP FUNCTION IF EXISTS public.fl_sam_price_extras(text);
