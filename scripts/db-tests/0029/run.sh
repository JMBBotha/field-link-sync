#!/usr/bin/env bash
# Local DB test for 0029 against a structural copy of live (no data). Needs local Postgres 17 (psql via sudo -u postgres).
set -euo pipefail
cd "$(dirname "$0")"
REPO=../../..
DB=${DB:-qlock29_test}
Q="sudo -u postgres env PGOPTIONS=-cclient_min_messages=warning psql -X -q -v ON_ERROR_STOP=1 -d"
P="sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d"
sudo -u postgres dropdb --if-exists "$DB" 2>/dev/null; sudo -u postgres createdb "$DB"
for f in live_schema.sql helpers_live.sql live_crons.sql helpers_0029.sql fixtures.sql; do $Q "$DB" -f $f >/dev/null; done
FNS="'fl_quote_items_lock_guard','fl_quotes_lock_guard','fl_lock_quote','unlock_quote','_client_contact_push'"
fp() { $P "$DB" -Atc "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by proname)) from pg_proc p where pronamespace='public'::regnamespace and proname in ($FNS)"; }
state() { $P "$DB" -Atc "select md5(string_agg(id||coalesce(locked_reason,'-')||coalesce(locked_at::text,'-'), ',' order by id)) from quotes"; }
BEFORE=$(fp); STATE=$(state)
echo "== before 0029"
$P "$DB" -f repro_0023.sql 2>&1 | grep -E 'PASS|FAIL' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "== apply 0029 (twice, idempotent)"
$Q "$DB" -f $REPO/drizzle/migrations/0029_quote_lock_after_accept.sql >/dev/null
$Q "$DB" -f $REPO/drizzle/migrations/0029_quote_lock_after_accept.sql >/dev/null
echo "== tests"
$P "$DB" -At -f tests.sql > /tmp/qlock29_tests.log 2>&1 || { grep -E 'PASS|FAIL|ERROR' /tmp/qlock29_tests.log | tail -5; echo "FAIL: tests"; exit 1; }
grep -E 'PASS|FAIL|ERROR|ALL TESTS' /tmp/qlock29_tests.log | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "== rollback (on a fresh copy so data state can be compared)"
sudo -u postgres dropdb "$DB"; sudo -u postgres createdb "$DB"
for f in live_schema.sql helpers_live.sql live_crons.sql helpers_0029.sql fixtures.sql; do $Q "$DB" -f $f >/dev/null; done
STATE=$(state)  # fixtures use now(), so take the baseline on this copy
$Q "$DB" -f $REPO/drizzle/migrations/0029_quote_lock_after_accept.sql >/dev/null
[ "$(state)" != "$STATE" ] || { echo "FAIL: backfill did nothing"; exit 1; }
$Q "$DB" -f $REPO/drizzle/rollback/0029_quote_lock_after_accept_rollback.sql >/dev/null
[ "$(fp)" = "$BEFORE" ] && echo "PASS: rollback restores the 5 live function bodies exactly (md5 $BEFORE)" || { echo "FAIL: rollback md5"; exit 1; }
[ "$(state)" = "$STATE" ] && echo "PASS: rollback removes the backfilled locks (site-check lock kept)" || { echo "FAIL: lock state after rollback"; exit 1; }
N=$($P "$DB" -Atc "select count(*) from pg_proc where proname in ('fl_quote_admin','fl_quote_issued_invoice','fl_quote_edit_block','fl_quote_autolock_on_accept','relock_quote','admin_create_quote_variation','admin_correct_client_details','fl_customer_has_locked_work','fl_customers_billing_guard','quote_lock_state')")
T=$($P "$DB" -Atc "select count(*) from pg_trigger where tgname in ('trg_quote_areas_lock_guard','trg_quote_line_items_lock_guard','trg_proposal_sections_lock_guard','trg_quotes_autolock_on_accept','trg_customers_billing_guard')")
[ "$N$T" = "00" ] && echo "PASS: rollback drops new functions and triggers" || { echo "FAIL: left $N fns $T triggers"; exit 1; }
$P "$DB" -f repro_0023.sql 2>&1 | grep -qE 'PASS' && echo "PASS: after rollback the old behaviour is back (0023 push fails again)"
echo "== re-apply after rollback"
$Q "$DB" -f $REPO/drizzle/migrations/0029_quote_lock_after_accept.sql >/dev/null && echo "PASS: 0029 re-applies cleanly after rollback"
