-- Rollback for 20261019070000_website_intake_hardening.sql (+ git revert of the receive-website-lead change).
DROP FUNCTION IF EXISTS public.fl_website_rate_hit(text, text, integer, integer);
DROP TABLE IF EXISTS public.website_rate_limits;
-- lead_source 'website_shop' stays (Postgres cannot drop an enum value); harmless while unused.
