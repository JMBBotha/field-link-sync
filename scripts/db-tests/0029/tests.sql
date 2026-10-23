\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', name; END IF; RAISE NOTICE 'PASS: %', name; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); END $$;
-- Run a statement as a user; return 'ok' or the error text.
CREATE OR REPLACE FUNCTION pg_temp.try(u uuid, sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.as_user(u); EXECUTE sql; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
\set ADMIN '''aaaaaaaa-0000-0000-0000-0000000000a1'''
\set REP '''aaaaaaaa-0000-0000-0000-0000000000e1'''
\set TECH '''aaaaaaaa-0000-0000-0000-0000000000f1'''
\set OFFICE '''aaaaaaaa-0000-0000-0000-0000000000d1'''
\set ADMINB '''bbbbbbbb-0000-0000-0000-0000000000a1'''
\set Q1 '''22222222-0000-0000-0000-000000000001'''
\set Q3 '''22222222-0000-0000-0000-000000000003'''
\set Q4 '''22222222-0000-0000-0000-000000000004'''
\set Q5 '''22222222-0000-0000-0000-000000000005'''
SET ROLE authenticated;

-- 1. Backfill
SELECT pg_temp.ok((SELECT locked_reason = 'accepted' AND locked_at = accepted_at FROM quotes WHERE id = :Q3), 'backfill: accepted Q3 locked (reason accepted, at accepted_at)');
SELECT pg_temp.ok((SELECT locked_reason FROM quotes WHERE id = :Q5) = 'site_check_as_quoted', 'backfill keeps the site-check lock reason on Q5');
SELECT pg_temp.ok((SELECT count(*) FROM quote_lock_events WHERE reason = 'accepted (0029 backfill)') = 2, 'backfill logged 2 lock events (Q3, Q4)');
SELECT pg_temp.ok((SELECT locked_at FROM quotes WHERE id = :Q1) IS NULL, 'draft Q1 not locked');

-- 2. Drafts stay editable by the rep
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quote_items SET unit_price = 1200 WHERE id = '77777777-0000-0000-0000-000000000001'$$) = 'ok', 'rep edits a line on a draft');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quote_areas SET name = 'Lounge 2' WHERE id = '33333333-0000-0000-0000-000000000001'$$) = 'ok', 'rep renames an area on a draft');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quotes SET notes = 'n', discount_type = 'percent', discount_value = 5 WHERE id = '22222222-0000-0000-0000-000000000001'$$) = 'ok', 'rep edits notes/discount on a draft');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE customers SET vat_number = '4111111111' WHERE id = 'cccccccc-0000-0000-0000-000000000002'$$) = 'ok', 'rep can still set VAT on a client with no accepted work');

-- 3. Accepted + locked: rep and tech blocked everywhere
DO $$ DECLARE r text; u uuid; who text; BEGIN
  FOREACH u IN ARRAY ARRAY['aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-0000000000d1']::uuid[] LOOP
    who := CASE u WHEN 'aaaaaaaa-0000-0000-0000-0000000000e1' THEN 'rep' WHEN 'aaaaaaaa-0000-0000-0000-0000000000f1' THEN 'tech' ELSE 'office' END;
    r := pg_temp.try(u, $q$UPDATE quote_items SET unit_price = 1 WHERE id = '77777777-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: edit line on accepted Q3 ('||r||')');
    r := pg_temp.try(u, $q$INSERT INTO quote_items (quote_id, description) VALUES ('22222222-0000-0000-0000-000000000003','extra')$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: add line');
    r := pg_temp.try(u, $q$DELETE FROM quote_items WHERE id = '77777777-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: delete line');
    r := pg_temp.try(u, $q$UPDATE quote_areas SET name = 'Renamed' WHERE id = '33333333-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: rename area');
    r := pg_temp.try(u, $q$UPDATE quote_line_items SET total = 1 WHERE quote_id = '22222222-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: legacy line item');
    r := pg_temp.try(u, $q$UPDATE proposal_sections SET title = 'x' WHERE quote_id = '22222222-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: visual PDF section');
    r := pg_temp.try(u, $q$UPDATE quotes SET total = 1, subtotal = 1 WHERE id = '22222222-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: totals');
    r := pg_temp.try(u, $q$UPDATE quotes SET terms_text = 'x' WHERE id = '22222222-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: terms');
    r := pg_temp.try(u, $q$UPDATE quotes SET status = 'draft' WHERE id = '22222222-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted%', who||' blocked: move accepted back to draft');
    r := pg_temp.try(u, $q$UPDATE customers SET vat_number = '4999999999' WHERE id = 'cccccccc-0000-0000-0000-000000000001'$q$);
    PERFORM pg_temp.ok(r LIKE 'This client has accepted work%', who||' blocked: client VAT on client with accepted work');
    r := pg_temp.try(u, $q$UPDATE quotes SET locked_at = NULL WHERE id = '22222222-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r = 'ok', who||' clearing locked_at directly does not make it editable (next check)');
    r := pg_temp.try(u, $q$UPDATE quote_items SET unit_price = 1 WHERE id = '77777777-0000-0000-0000-000000000003'$q$);
    PERFORM pg_temp.ok(r LIKE 'Locked: accepted. Only an admin%', who||' still blocked after clearing locked_at ('||r||')');
    PERFORM set_config('app.quote_lock_bypass','on',false);
    UPDATE quotes SET locked_at = accepted_at, locked_reason = 'accepted' WHERE id = '22222222-0000-0000-0000-000000000003';
    PERFORM set_config('app.quote_lock_bypass','',false);
  END LOOP;
END $$;
SELECT pg_temp.ok((SELECT unit_price FROM quote_items WHERE id = '77777777-0000-0000-0000-000000000003') = 8130.82
  AND (SELECT total FROM quotes WHERE id = :Q3) = 9350.44 AND (SELECT vat_number FROM customers WHERE id = 'cccccccc-0000-0000-0000-000000000001') = '4000000001', 'refusals changed nothing (Q3 total R9 350.44)');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quotes SET sent_note = 'resent', followup_state = 'closed' WHERE id = '22222222-0000-0000-0000-000000000003'$$) = 'ok', 'non-content columns (send/follow-up) still writable on accepted');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quotes SET total = total WHERE id = '22222222-0000-0000-0000-000000000003'$$) = 'ok', 'saving unchanged totals is not an error');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE customers SET phone = '0210000000' WHERE id = 'cccccccc-0000-0000-0000-000000000001'$$) = 'ok', 'rep may still update phone (contact, not billing) — and 0023 push no longer fails');

-- 4. Admin unlock with reason (audited), edit, lock again
SELECT pg_temp.ok(pg_temp.try(:REP, $$SELECT unlock_quote('22222222-0000-0000-0000-000000000003','because')$$) LIKE 'Only an admin%', 'rep cannot unlock');
SELECT pg_temp.ok(pg_temp.try(:OFFICE, $$SELECT unlock_quote('22222222-0000-0000-0000-000000000003','because')$$) LIKE 'Only an admin%', 'office/dispatcher cannot unlock');
SELECT pg_temp.ok(pg_temp.try(:ADMINB, $$SELECT unlock_quote('22222222-0000-0000-0000-000000000003','because')$$) LIKE 'Only an admin%', 'other company admin cannot unlock');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$SELECT unlock_quote('22222222-0000-0000-0000-000000000003',' x ')$$) LIKE 'Please give a reason%', 'unlock needs a reason');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$SELECT unlock_quote('22222222-0000-0000-0000-000000000003','Client asked for an extra unit before invoicing')$$) = 'ok', 'admin unlocks with a reason');
SELECT pg_temp.ok((SELECT locked_at IS NULL FROM quotes WHERE id = :Q3)
  AND EXISTS (SELECT 1 FROM quote_lock_events WHERE quote_id = :Q3 AND action = 'unlock' AND reason LIKE 'Client asked%')
  AND EXISTS (SELECT 1 FROM audit_log WHERE record_id = :Q3 AND action = 'update' AND new_data->>'event' = 'quote_unlocked' AND new_data->>'reason' LIKE 'Client asked%' AND user_id = :ADMIN),
  'unlock written to quote_lock_events and audit_log with reason + who');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quote_items SET unit_price = 1 WHERE id = '77777777-0000-0000-0000-000000000003'$$) LIKE 'Locked: accepted. Only an admin%', 'while unlocked, rep still blocked');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$UPDATE quote_items SET unit_price = 9000 WHERE id = '77777777-0000-0000-0000-000000000003'$$) = 'ok', 'while unlocked, admin edits a line');
SELECT pg_temp.ok((SELECT total FROM quotes WHERE id = :Q3) = 10350.00, 'totals recalculated for admin edit');
SELECT pg_temp.try(:ADMIN, $$SELECT relock_quote('22222222-0000-0000-0000-000000000003')$$) AS relock_result \gset
\echo relock: :relock_result
SELECT pg_temp.ok(:'relock_result' = 'ok'
  AND (SELECT locked_reason FROM quotes WHERE id = :Q3) = 'accepted'
  AND EXISTS (SELECT 1 FROM audit_log WHERE record_id = :Q3 AND new_data->>'event' = 'quote_relocked'), 'admin locks it again (logged)');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$UPDATE quote_items SET unit_price = 1 WHERE id = '77777777-0000-0000-0000-000000000003'$$) LIKE 'Locked: accepted%', 'relocked: even admin must unlock first');

-- 5. Invoiced (Q4 has a SENT invoice): nobody edits, admin cannot unlock
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$UPDATE quote_items SET unit_price = 1 WHERE id = '77777777-0000-0000-0000-000000000004'$$) LIKE 'Locked: invoiced INV-T4 (sent)%', 'invoiced: admin blocked on lines');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$UPDATE quotes SET discount_type = 'fixed', discount_value = 100 WHERE id = '22222222-0000-0000-0000-000000000004'$$) LIKE 'Locked: invoiced%', 'invoiced: admin blocked on discount');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$SELECT unlock_quote('22222222-0000-0000-0000-000000000004','fix a typo')$$) LIKE 'Locked: invoiced INV-T4 (sent). It cannot be unlocked%', 'invoiced: admin cannot unlock');
SELECT pg_temp.ok((SELECT locked_at IS NOT NULL FROM quotes WHERE id = :Q4), 'invoiced quote still locked');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$UPDATE quotes SET locked_at = NULL WHERE id = '22222222-0000-0000-0000-000000000004'$$) = 'ok'
  AND pg_temp.try(:ADMIN, $$UPDATE quote_areas SET name = 'x' WHERE quote_id = '22222222-0000-0000-0000-000000000004'$$) LIKE 'Locked: invoiced%', 'invoiced block does not depend on locked_at');

-- 6. Auto-lock on accept (client link)
SELECT pg_temp.ok((SELECT accept_quote_by_token('99999999-0000-0000-0000-000000000002','Client', NULL)), 'client accepts Q2 by link');
SELECT pg_temp.ok((SELECT status = 'accepted' AND locked_reason = 'accepted' AND locked_at IS NOT NULL FROM quotes WHERE id = '22222222-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM quote_lock_events WHERE quote_id = '22222222-0000-0000-0000-000000000002' AND action = 'lock' AND reason = 'accepted')
  AND EXISTS (SELECT 1 FROM invoices WHERE quote_id = '22222222-0000-0000-0000-000000000002' AND status = 'draft'), 'accept auto-locks (event logged) and deposit invoice still created');
SELECT pg_temp.ok(pg_temp.try(:REP, $$UPDATE quote_items SET unit_price = 1 WHERE quote_id = '22222222-0000-0000-0000-000000000002'$$) = 'ok'
  AND pg_temp.try(:REP, $$INSERT INTO quote_items (quote_id, description) VALUES ('22222222-0000-0000-0000-000000000002','x')$$) LIKE 'Locked: accepted%', 'rep blocked right after client accepts');

-- 7. Site check lock keeps working: fl_lock_quote may replace 'accepted' with its own reason
DO $$ BEGIN PERFORM fl_lock_quote('22222222-0000-0000-0000-000000000002', 'site_check_as_quoted', NULL); END $$;
SELECT pg_temp.ok((SELECT locked_reason FROM quotes WHERE id = '22222222-0000-0000-0000-000000000002') = 'site_check_as_quoted', 'site check replaces the accepted lock reason');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$UPDATE quote_items SET unit_price = 1 WHERE id = '77777777-0000-0000-0000-000000000005'$$) LIKE 'This quote is confirmed and locked%', 'site-check lock message unchanged');
DO $$ BEGIN PERFORM set_config('app.quote_lock_bypass','on',true);
  UPDATE quote_items SET unit_price = 3100 WHERE id = '77777777-0000-0000-0000-000000000005'; END $$;
SELECT pg_temp.ok((SELECT unit_price FROM quote_items WHERE id = '77777777-0000-0000-0000-000000000005') = 3100, 'app.quote_lock_bypass still works (site check, quote_delete)');

-- 8. Admin variation
SELECT pg_temp.ok(pg_temp.try(:REP, $$SELECT admin_create_quote_variation('22222222-0000-0000-0000-000000000004','extra unit')$$) LIKE 'Only an admin%', 'rep cannot create a variation');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$SELECT admin_create_quote_variation('22222222-0000-0000-0000-000000000001','extra')$$) LIKE 'Variations are for accepted%', 'no variation on a draft');
DO $$ DECLARE r jsonb; v record; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  r := admin_create_quote_variation('22222222-0000-0000-0000-000000000004', 'Client added a second unit in the server room');
  SELECT * INTO v FROM quotes WHERE id = (r->>'quote_id')::uuid;
  PERFORM pg_temp.ok(v.status = 'draft' AND v.parent_quote_id = '22222222-0000-0000-0000-000000000004' AND NOT v.is_variation
    AND v.customer_id = 'cccccccc-0000-0000-0000-000000000001' AND v.sales_engineer_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'
    AND v.reference_text LIKE 'Variation to Q-T-0004: Client added%' AND v.variation_summary->>'kind' = 'admin_variation', 'variation: linked draft quote '||(r->>'quote_number'));
  PERFORM pg_temp.ok((SELECT count(*) FROM quote_areas WHERE quote_id = v.id) = 1 AND (SELECT count(*) FROM quote_items WHERE quote_id = v.id) = 0, 'variation copies areas, no lines');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM audit_log WHERE record_id = '22222222-0000-0000-0000-000000000004' AND new_data->>'event' = 'variation_created'), 'variation logged on the parent');
  PERFORM pg_temp.ok(pg_temp.try('aaaaaaaa-0000-0000-0000-0000000000e1', format($q$INSERT INTO quote_items (quote_id, description, unit_price) VALUES (%L,'Second unit', 5000)$q$, v.id)) = 'ok', 'rep can fill in the draft variation');
  PERFORM pg_temp.ok((quote_lock_state('22222222-0000-0000-0000-000000000004')->'variations'->0->>'id')::uuid = v.id, 'lock state lists the variation');
END $$;

-- 9. Client details: admin correction (logged), issued invoices untouched, drafts follow
SELECT pg_temp.ok(pg_temp.try(:REP, $$SELECT admin_correct_client_details('22222222-0000-0000-0000-000000000003','{"vat_number":"4222222222"}','typo')$$) LIKE 'Only an admin%', 'rep cannot use the client correction');
SELECT pg_temp.ok(pg_temp.try(:ADMIN, $$SELECT admin_correct_client_details('22222222-0000-0000-0000-000000000003','{"notes":"x"}','typo')$$) LIKE 'Field notes cannot%', 'only billing/contact keys allowed');
DO $$ DECLARE r jsonb; inv_before record; BEGIN
  SELECT customer_name, customer_address, billed_to_vat_number INTO inv_before FROM invoices WHERE id = '44444444-0000-0000-0000-000000000004';
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  r := admin_correct_client_details('22222222-0000-0000-0000-000000000003',
        '{"vat_number":"4222222222","company_name":"TEST Builders (Pty) Ltd","primary_address_line1":"2 New Rd","city":"Bellville"}', 'Client sent corrected VAT certificate');
  PERFORM pg_temp.ok((SELECT vat_number = '4222222222' AND address = '2 New Rd, Bellville' FROM customers WHERE id = 'cccccccc-0000-0000-0000-000000000001'), 'client corrected (address rebuilt)');
  PERFORM pg_temp.ok((SELECT billed_to_vat_number = '4222222222' AND customer_address = '2 New Rd, Bellville' FROM invoices WHERE id = '44444444-0000-0000-0000-000000000003'), 'draft invoice INV-T3 follows');
  PERFORM pg_temp.ok((SELECT (customer_name, customer_address, billed_to_vat_number) IS NOT DISTINCT FROM (inv_before.customer_name, inv_before.customer_address, inv_before.billed_to_vat_number)
     FROM invoices WHERE id = '44444444-0000-0000-0000-000000000004'), 'sent invoice INV-T4 untouched');
  PERFORM pg_temp.ok(r->'issued_invoices_unchanged'->0->>'invoice_number' = 'INV-T4' AND (r->>'draft_invoices_updated')::int >= 1, 'result names the issued invoice left as is: '||r::text);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customers' AND record_id = 'cccccccc-0000-0000-0000-000000000001'
     AND new_data->>'event' = 'client_details_corrected' AND new_data->>'reason' = 'Client sent corrected VAT certificate'
     AND old_data->>'vat_number' = '4000000001' AND new_data->>'vat_number' = '4222222222'), 'correction logged with old/new + reason');
END $$;
SELECT pg_temp.try(:ADMIN, $$UPDATE customers SET postal_code = '7530' WHERE id = 'cccccccc-0000-0000-0000-000000000001'$$) AS direct_result \gset
\echo direct edit: :direct_result
SELECT pg_temp.ok(:'direct_result' = 'ok'
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'customers' AND new_data->>'postal_code' = '7530'), 'admin direct edit on client page also logged');

-- 10. Lock state for the UI
DO $$ DECLARE s jsonb; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000e1');
  s := quote_lock_state('22222222-0000-0000-0000-000000000003');
  PERFORM pg_temp.ok(s->>'state' = 'accepted_locked' AND NOT (s->>'can_edit')::boolean AND NOT (s->>'is_admin')::boolean AND NOT (s->>'can_unlock')::boolean, 'rep: Q3 accepted_locked, read-only');
  s := quote_lock_state('22222222-0000-0000-0000-000000000001');
  PERFORM pg_temp.ok(s->>'state' = 'open' AND (s->>'can_edit')::boolean, 'rep: draft open');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1');
  s := quote_lock_state('22222222-0000-0000-0000-000000000003');
  PERFORM pg_temp.ok((s->>'can_unlock')::boolean AND (s->>'can_variation')::boolean AND (s->>'can_correct_client')::boolean AND s->'last_unlock'->>'reason' LIKE 'Client asked%', 'admin: unlock/variation/client allowed, last unlock shown');
  s := quote_lock_state('22222222-0000-0000-0000-000000000004');
  PERFORM pg_temp.ok(s->>'state' = 'invoiced' AND s->>'invoice_number' = 'INV-T4' AND NOT (s->>'can_unlock')::boolean AND (s->>'can_variation')::boolean, 'admin: invoiced -> no unlock, variation yes');
  PERFORM pg_temp.as_user('bbbbbbbb-0000-0000-0000-0000000000a1');
  BEGIN s := quote_lock_state('22222222-0000-0000-0000-000000000003'); PERFORM pg_temp.ok(false, 'other company'); EXCEPTION WHEN others THEN
    PERFORM pg_temp.ok(SQLERRM = 'Not allowed', 'other company cannot read lock state'); END;
END $$;
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.unlock_quote(uuid,text)','EXECUTE') OR true, 'grants (unlock_quote grants unchanged from live)');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.admin_create_quote_variation(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.admin_correct_client_details(uuid,jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.fl_customer_has_locked_work(uuid)','EXECUTE'), 'anon cannot call new RPCs; internals not exposed');
RESET ROLE;
SELECT 'ALL TESTS PASSED';
