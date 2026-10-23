#!/bin/bash
# Local proof for 0026 on a throwaway Postgres 17 (no Supabase, no network, no emails).
set -e; cd "$(dirname "$0")"
sudo -u postgres dropdb --if-exists isa26; sudo -u postgres createdb isa26
P="sudo -u postgres psql -q -X -v ON_ERROR_STOP=1 -d isa26"
M=../../../drizzle
$P -f ../0025/stub_schema.sql 2>/dev/null
$P -f $M/migrations/0025_accept_invoice_approval.sql 2>/dev/null
$P -f extras.sql 2>/dev/null
$P -f test_before.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
$P -f $M/migrations/0026_accept_alert_merge.sql 2>/dev/null
$P -f $M/migrations/0026_accept_alert_merge.sql 2>/dev/null && echo "PASS: 0026 applies twice (idempotent)"
$P -f test_0026.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
$P -f test_order.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
$P -f $M/rollback/0026_accept_alert_merge_rollback.sql 2>/dev/null && echo "rollback applied"
$P -f test_rollback.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
for f in isa_queue p3_notify_quote_accepted notify_quote_status_change; do
  echo "after rollback $f md5: $($P -At -c "SELECT md5(pg_get_functiondef('public.$f'::regproc))")"
done
