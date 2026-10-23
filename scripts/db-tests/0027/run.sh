#!/usr/bin/env bash
# Local DB test for 0027 against a structural copy of live (no data). Needs local Postgres 17 (psql via sudo -u postgres).
set -euo pipefail
cd "$(dirname "$0")"
REPO=../../..
DB=${DB:-qda27_test}
Q="sudo -u postgres env PGOPTIONS=-cclient_min_messages=warning psql -X -q -v ON_ERROR_STOP=1 -d"
P="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d"
sudo -u postgres dropdb --if-exists "$DB" 2>/dev/null; sudo -u postgres createdb "$DB"
$Q "$DB" -f live_schema.sql >/dev/null
$Q "$DB" -f helpers_live.sql >/dev/null
$Q "$DB" -f live_crons.sql >/dev/null
fp() { $P "$DB" -Atc "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by proname)) from pg_proc p where pronamespace='public'::regnamespace and proname in ('process_quote_followups','quotes_followup_due_count','process_sales_escalations')"; }
cols() { $P "$DB" -Atc "select count(*) from information_schema.columns where table_name='quotes' and column_name like 'archive%'"; }
BEFORE=$(fp)
echo "== apply 0027 (twice, idempotent)"
$Q "$DB" -f $REPO/drizzle/migrations/0027_quote_delete_archive.sql >/dev/null
$Q "$DB" -f $REPO/drizzle/migrations/0028_quote_archive_audit_fix.sql >/dev/null
[ "$(fp)" != "$BEFORE" ] || { echo "FAIL: crons not patched"; exit 1; }
$Q "$DB" -f fixtures.sql >/dev/null
echo "== tests"
$P "$DB" -At -f tests.sql > /tmp/qda27_tests.log 2>&1 || { cat /tmp/qda27_tests.log; echo "FAIL: tests"; exit 1; }
grep -E 'PASS|FAIL|ERROR|ALL TESTS' /tmp/qda27_tests.log | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "== rollback"
$Q "$DB" -f $REPO/drizzle/rollback/0027_quote_delete_archive_rollback.sql >/dev/null
[ "$(fp)" = "$BEFORE" ] && echo "PASS: rollback restores live cron function bodies exactly (md5 $BEFORE)" || { echo "FAIL: rollback md5"; exit 1; }
[ "$(cols)" = "0" ] && echo "PASS: rollback drops archive columns" || { echo "FAIL: columns"; exit 1; }
N=$($P "$DB" -Atc "select count(*) from pg_proc where proname in ('quote_delete','quote_archive','quote_unarchive','quote_delete_check','_quote_admin_row','_quote_delete_facts','_quote_snapshot')")
[ "$N" = "0" ] && echo "PASS: rollback drops RPCs" || { echo "FAIL: rpcs left"; exit 1; }
$P "$DB" -Atc "select public.process_quote_followups(); select public.process_sales_escalations(); select public.quotes_followup_due_count()" >/dev/null && echo "PASS: crons run after rollback"
echo "== re-apply after rollback"
$Q "$DB" -f $REPO/drizzle/migrations/0027_quote_delete_archive.sql >/dev/null && $Q "$DB" -f $REPO/drizzle/migrations/0028_quote_archive_audit_fix.sql >/dev/null && echo "PASS: 0027+0028 re-apply cleanly after rollback"
