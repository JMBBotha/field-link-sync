-- Apply by hand at go-live, after: VAPID secrets set (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT),
-- send-push deployed, and vault secret 'push_cron_key' holding a key the function accepts (PUSH_CRON_KEY).
-- Rollback: SELECT cron.unschedule('push-outbox-drain');
SELECT cron.schedule('push-outbox-drain', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','x-push-key',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_cron_key')),
    body := '{}'::jsonb)
$$);
