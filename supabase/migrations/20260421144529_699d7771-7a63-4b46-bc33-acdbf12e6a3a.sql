SELECT cron.unschedule('nightly-overlay-audit')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-overlay-audit');

SELECT cron.schedule(
  'nightly-overlay-audit',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/audit-overlay-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2emFwZmJpZmdnb3ZjY2VicmpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NTUxNTgsImV4cCI6MjA3NTUzMTE1OH0.RE6qYCpqtYVDDm-7xC7NHMYhRdn9WegzSMRId3WT_I4'
    ),
    body := jsonb_build_object('triggered_by', 'cron')
  );
  $$
);