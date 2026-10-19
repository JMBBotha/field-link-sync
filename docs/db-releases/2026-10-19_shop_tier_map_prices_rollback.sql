-- Rollback for 20261019080000_shop_tier_map_prices.sql (+ git revert; shop-prices then 404s / the website falls back to "talk to Sam").
DROP FUNCTION IF EXISTS public.fl_shop_tier_map_set(uuid, integer, text, uuid);
DROP FUNCTION IF EXISTS public.fl_shop_tier_map_admin(uuid);
DROP FUNCTION IF EXISTS public.fl_shop_quote(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.fl_shop_price_list(uuid);
DROP FUNCTION IF EXISTS public.fl_shop_item_public(uuid);
DROP FUNCTION IF EXISTS public.fl_shop_size_btu(text);
DROP FUNCTION IF EXISTS public.fl_shop_sell_ex(uuid, uuid);
DROP TABLE IF EXISTS public.shop_tier_map;
