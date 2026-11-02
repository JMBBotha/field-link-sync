-- Apply by hand after Johan approves the migration. Rollback: SELECT cron.unschedule('request-alerts-tick'); SELECT cron.unschedule('lead-offer-tick');
SELECT cron.schedule('request-alerts-tick', '*/5 * * * *', $$SELECT public.fl_request_alerts_tick()$$);
SELECT cron.schedule('lead-offer-tick', '* * * * *', $$SELECT public.fl_offer_tick()$$);
