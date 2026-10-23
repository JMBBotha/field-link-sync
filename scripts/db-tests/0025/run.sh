#!/bin/bash
# Local proof for 0025 on a throwaway Postgres 17 (no Supabase, no network, no emails).
set -e; cd "$(dirname "$0")"
sudo -u postgres dropdb --if-exists isa; sudo -u postgres createdb isa
P="sudo -u postgres psql -q -X -v ON_ERROR_STOP=1 -d isa"
$P -f stub_schema.sql 2>/dev/null
$P -f ../../../drizzle/migrations/0025_accept_invoice_approval.sql 2>/dev/null
$P -f ../../../drizzle/migrations/0025_accept_invoice_approval.sql 2>/dev/null && echo "PASS: 0025 applies twice (idempotent)"
$P -f test_0025.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
$P -f test_rls.sql 2>&1 | grep -E "PASS|FAIL|ERROR|sees|events" 
# concurrency: session A holds the due row lock; session B's cron run must skip it
$P -c "UPDATE invoice_send_approvals SET status='pending', due_at=now()-interval '1 min' WHERE quote_number='Q-T4'" 
( $P -c "BEGIN; SELECT 1 FROM invoice_send_approvals WHERE quote_number='Q-T4' FOR UPDATE; SELECT pg_sleep(3); COMMIT;" >/dev/null ) &
sleep 1
B=$($P -At -c "SELECT process_due_invoice_sends()"); echo "concurrent run while locked sent: $B (expect 0)"
wait
A=$($P -At -c "SELECT process_due_invoice_sends()"); echo "run after lock released sent: $A (expect 1)"
$P -At -c "SELECT 'emails for Q-T4: '||count(*) FROM fake_outbox o JOIN invoice_send_approvals a ON a.invoice_id=o.invoice_id WHERE a.quote_number='Q-T4'"
# rollback file restores the 0024 state
$P -f ../../../drizzle/rollback/0025_accept_invoice_approval_rollback.sql 2>/dev/null
$P -At -c "SELECT 'after rollback: approvals table '||coalesce(to_regclass('public.invoice_send_approvals')::text,'gone')||', send_now fn '||coalesce(to_regprocedure('public.invoice_send_now(uuid)')::text,'gone')"
$P -At -c "INSERT INTO quotes(quote_number,status,company_id,customer_id,sales_engineer_id,total,vat_amount) VALUES('Q-RB','accepted','a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',100,13)"
$P -At -c "SELECT create_deposit_invoice_for_quote((SELECT id FROM quotes WHERE quote_number='Q-RB'))" >/dev/null
$P -At -c "SELECT 'after rollback: accept -> '||i.status||' invoice, notice type '||(SELECT string_agg(DISTINCT type, ',') FROM notifications n WHERE n.related_id=i.id)||', emails '||(SELECT count(*) FROM fake_outbox o WHERE o.invoice_id=i.id) FROM invoices i WHERE i.quote_id=(SELECT id FROM quotes WHERE quote_number='Q-RB')"
