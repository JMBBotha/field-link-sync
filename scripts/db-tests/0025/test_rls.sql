\set ON_ERROR_STOP 1
SET ROLE authenticated;
SELECT set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
SELECT 'rep A sees' who, count(*) FROM invoice_send_approvals;
SELECT set_config('test.uid','22222222-2222-2222-2222-222222222222',false);
SELECT 'admin A sees' who, count(*) FROM invoice_send_approvals;
SELECT set_config('test.uid','33333333-3333-3333-3333-333333333333',false);
SELECT 'admin B sees' who, count(*) FROM invoice_send_approvals UNION ALL SELECT 'admin B events', count(*) FROM invoice_send_events;
SELECT set_config('test.uid','44444444-4444-4444-4444-444444444444',false);
SELECT 'other rep A sees' who, count(*) FROM invoice_send_approvals;
DO $$ BEGIN UPDATE invoice_send_approvals SET status='sent'; RAISE NOTICE 'direct update allowed?!'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: direct update refused'; END $$;
DO $$ BEGIN PERFORM process_due_invoice_sends(); RAISE NOTICE 'cron fn callable by user?!'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: cron fn not callable by users'; END $$;
