-- Rollback for 20261019090000_shop_orders_checkout.sql (+ git revert). Only safe while no real shop order exists
-- (check: SELECT count(*) FROM shop_orders WHERE status='finalized'). Records a finalized order created stay.
DROP FUNCTION IF EXISTS public.fl_shop_mark_emailed(uuid);
DROP FUNCTION IF EXISTS public.fl_shop_finalize(uuid, text, text, bigint, text, jsonb);
DROP FUNCTION IF EXISTS public.fl_shop_order_note_event(uuid, jsonb);
DROP FUNCTION IF EXISTS public.fl_shop_order_set_checkout(uuid, text);
DROP FUNCTION IF EXISTS public.fl_shop_order_create(uuid, jsonb, jsonb, jsonb, text, text, text, text);
DROP TABLE IF EXISTS public.shop_orders;
-- get_public_quote: restore the previous definition
-- Step 2: run docs/db-releases/2026-10-19_get_public_quote_before_shop.sql (separate query; restores get_public_quote without remote_quote_source).
