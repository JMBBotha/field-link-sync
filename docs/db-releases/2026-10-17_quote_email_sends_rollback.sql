-- Rollback for 20261017110000_quote_email_sends.sql (drops the send record + lock; no other data touched).
DO $$ BEGIN PERFORM cron.unschedule('quote-email-sends-expire') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quote-email-sends-expire'); END $$;
DROP FUNCTION IF EXISTS public.quote_email_send_state(uuid);
DROP FUNCTION IF EXISTS public.expire_stale_quote_email_sends(uuid);
DROP FUNCTION IF EXISTS public.notify_quote_email_failed(uuid);
DROP TABLE IF EXISTS public.quote_email_sends;
-- Optional: DELETE FROM public.notifications WHERE type = 'quote_email_failed';
