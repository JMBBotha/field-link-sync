-- Apply by hand at go-live, after vault secrets vapid_public_key, vapid_private_key, vapid_subject, push_cron_key exist
-- and send-push is deployed.
-- Rollback: SELECT cron.unschedule('push-outbox-drain');
SELECT cron.schedule('push-outbox-drain', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-push-key',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_cron_key')),
    body := '{}'::jsonb)
$$);
