\set ON_ERROR_STOP 1
-- fixtures
INSERT INTO companies (id,name,is_master) VALUES ('a0000000-0000-0000-0000-00000000000a','Massair CT',true),('b0000000-0000-0000-0000-00000000000b','Other Co',false);
INSERT INTO profiles VALUES ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-00000000000a','Rep A'),
 ('22222222-2222-2222-2222-222222222222','a0000000-0000-0000-0000-00000000000a','Admin A'),
 ('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-00000000000b','Admin B'),
 ('44444444-4444-4444-4444-444444444444','a0000000-0000-0000-0000-00000000000a','Other rep A');
INSERT INTO user_roles (user_id,role) VALUES ('22222222-2222-2222-2222-222222222222','admin'),('33333333-3333-3333-3333-333333333333','admin'),
 ('11111111-1111-1111-1111-111111111111','field_agent'),('44444444-4444-4444-4444-444444444444','field_agent');
INSERT INTO company_settings (company_id,is_primary) VALUES ('a0000000-0000-0000-0000-00000000000a',true);
INSERT INTO customers (id,name,email) VALUES ('c0000000-0000-0000-0000-000000000001','Test Client','test@example.invalid'),
 ('c0000000-0000-0000-0000-000000000002','No Email Client',NULL);
SELECT setval('invoice_number_seq', 41, true);
CREATE FUNCTION mkq(n text, cust uuid, rep uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO quotes (quote_number,status,company_id,customer_id,customer_name,sales_engineer_id,total,vat_amount,vat_rate,created_by)
  VALUES (n,'accepted','a0000000-0000-0000-0000-00000000000a',cust,'Test Client',rep,1150,150,0.15,'22222222-2222-2222-2222-222222222222') RETURNING id $$;
CREATE FUNCTION ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; RAISE NOTICE 'PASS: %', msg; END $$;

-- 1 accept creates draft + pending approval due in ~15 min + alerts rep and admin A only; nothing sent
DO $$ DECLARE q uuid := mkq('Q-T1','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'); i uuid; a record; BEGIN
  i := create_deposit_invoice_for_quote(q);
  SELECT * INTO a FROM invoice_send_approvals WHERE invoice_id = i;
  PERFORM ok((SELECT status FROM invoices WHERE id=i)='draft','1 invoice is draft');
  PERFORM ok(a.status='pending' AND a.due_at BETWEEN now()+interval '14 min' AND now()+interval '16 min','1 approval pending, due in 15 min');
  PERFORM ok(a.deposit_amount = 805,'1 deposit 70% of 1150 = 805');
  PERFORM ok((SELECT array_agg(user_id ORDER BY user_id)::text FROM notifications WHERE related_id=i AND type='quote_accepted_send_invoice')
     = '{11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222}','1 alert to rep A + admin A only (not admin B / other rep)');
  PERFORM ok((SELECT title FROM notifications WHERE related_id=i LIMIT 1)='Test Client accepted Q-T1','1 alert title');
  PERFORM ok((SELECT count(*) FROM fake_outbox)=0,'1 nothing emailed on accept');
  PERFORM ok(create_deposit_invoice_for_quote(q)=i AND (SELECT count(*) FROM invoice_send_approvals WHERE quote_id=q)=1,'1 re-accept idempotent');
  PERFORM ok(process_due_invoice_sends()=0 AND (SELECT count(*) FROM fake_outbox)=0,'1 cron before due sends nothing');
  UPDATE invoice_send_approvals SET due_at = now() - interval '1 min' WHERE id=a.id;
  PERFORM ok(process_due_invoice_sends()=1,'1 cron after due sends one');
  PERFORM ok(process_due_invoice_sends()=0,'1 second cron run sends nothing');
  PERFORM ok((SELECT count(*) FROM fake_outbox WHERE invoice_id=i)=1 AND (SELECT send_trigger FROM fake_outbox WHERE invoice_id=i)='accept_approval_auto','1 exactly one email, tagged auto');
  PERFORM ok((SELECT status||'/'||decision FROM invoice_send_approvals WHERE id=a.id)='sent/auto' AND (SELECT sent_by FROM invoices WHERE id=i) IS NULL,'1 audit: auto');
END $$;

-- 2 rep taps Send now (twice) => one email, audit shows the rep
DO $$ DECLARE q uuid := mkq('Q-T2','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'); i uuid; r jsonb; BEGIN
  i := create_deposit_invoice_for_quote(q);
  PERFORM set_config('test.uid','11111111-1111-1111-1111-111111111111',true);
  r := invoice_send_now(i); PERFORM ok(r->>'result'='sent','2 send now -> sent');
  r := invoice_send_now(i); PERFORM ok(r->>'result'='already_sent','2 second tap -> already_sent');
  PERFORM set_config('test.uid','',true);
  PERFORM ok((SELECT count(*) FROM fake_outbox WHERE invoice_id=i)=1,'2 one email only');
  PERFORM ok((SELECT decided_by::text||'/'||decision FROM invoice_send_approvals WHERE invoice_id=i)='11111111-1111-1111-1111-111111111111/send_now','2 audit who/what');
  PERFORM ok((SELECT sent_by FROM invoices WHERE id=i)='11111111-1111-1111-1111-111111111111','2 invoice.sent_by = rep');
  PERFORM ok(process_due_invoice_sends()=0,'2 cron does nothing after send now');
END $$;

-- 3 admin holds (with reason) => cron skips; later Send now works
DO $$ DECLARE q uuid := mkq('Q-T3','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'); i uuid; r jsonb; BEGIN
  i := create_deposit_invoice_for_quote(q);
  PERFORM set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  r := invoice_send_hold(i,'Client wants to change the unit'); PERFORM ok(r->>'result'='held','3 hold -> held');
  r := invoice_send_hold(i,NULL); PERFORM ok(r->>'result'='already_held','3 hold twice -> already_held');
  PERFORM set_config('test.uid','',true);
  UPDATE invoice_send_approvals SET due_at = now() - interval '1 min' WHERE invoice_id=i; -- even if a due_at sneaks back
  PERFORM ok(process_due_invoice_sends()=0 AND (SELECT count(*) FROM fake_outbox WHERE invoice_id=i)=0,'3 held invoice never auto-sends');
  PERFORM ok((SELECT hold_reason FROM invoice_send_approvals WHERE invoice_id=i)='Client wants to change the unit','3 hold reason kept');
  PERFORM set_config('test.uid','22222222-2222-2222-2222-222222222222',true);
  r := invoice_send_now(i); PERFORM ok(r->>'result'='sent','3 send now after hold');
  PERFORM set_config('test.uid','',true);
  PERFORM ok((SELECT string_agg(action, ',' ORDER BY id) FROM invoice_send_events WHERE invoice_id=i)='queued,held,sent_now','3 audit trail queued,held,sent_now');
END $$;

-- 4 POPIA / authz: other company admin, other rep, anonymous => refused
DO $$ DECLARE q uuid := mkq('Q-T4','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'); i uuid; u text; n int := 0; BEGIN
  i := create_deposit_invoice_for_quote(q);
  FOREACH u IN ARRAY ARRAY['33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',''] LOOP
    PERFORM set_config('test.uid',u,true);
    BEGIN PERFORM invoice_send_now(i); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
    BEGIN PERFORM invoice_send_hold(i,'x'); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  END LOOP;
  PERFORM set_config('test.uid','',true);
  PERFORM ok(n=6,'4 admin B, other rep and anon all refused (send + hold)');
  PERFORM ok((SELECT status FROM invoice_send_approvals WHERE invoice_id=i)='pending','4 still pending');
END $$;

-- 5 sent by hand via the old Send button path (plain status update) => approval closed, cron never re-sends
DO $$ DECLARE q uuid := mkq('Q-T5','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'); i uuid; BEGIN
  i := create_deposit_invoice_for_quote(q);
  UPDATE invoices SET status='sent', sent_at=now(), sent_method='email' WHERE id=i;
  PERFORM ok((SELECT status||'/'||decision FROM invoice_send_approvals WHERE invoice_id=i)='sent/manual','5 manual send closes approval');
  UPDATE invoice_send_approvals SET due_at = now() - interval '1 min' WHERE invoice_id=i;
  PERFORM ok(process_due_invoice_sends()=0 AND (SELECT count(*) FROM fake_outbox WHERE invoice_id=i)=1,'5 still exactly one email');
END $$;

-- 6 no client email => blocked + "did not send" alert, no email
DO $$ DECLARE q uuid := mkq('Q-T6','c0000000-0000-0000-0000-000000000002',NULL); i uuid; BEGIN
  i := create_deposit_invoice_for_quote(q);
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id=i AND type='quote_accepted_send_invoice')=1,'6 no rep -> admins only alerted');
  UPDATE invoice_send_approvals SET due_at = now() - interval '1 min' WHERE invoice_id=i;
  PERFORM ok(process_due_invoice_sends()=0,'6 cron sends nothing');
  PERFORM ok((SELECT status||'/'||last_error FROM invoice_send_approvals WHERE invoice_id=i)='blocked/no client email','6 blocked with reason');
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id=i AND type='invoice_send_blocked')=1,'6 blocked alert to admin');
  PERFORM ok((SELECT count(*) FROM fake_outbox WHERE invoice_id=i)=0,'6 no email');
END $$;

-- 7 voiding the draft cancels the approval
DO $$ DECLARE q uuid := mkq('Q-T7','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'); i uuid; BEGIN
  i := create_deposit_invoice_for_quote(q);
  UPDATE invoices SET status='void' WHERE id=i;
  PERFORM ok((SELECT status FROM invoice_send_approvals WHERE invoice_id=i)='cancelled','7 void -> cancelled');
END $$;

-- 8 setting 0 = never auto-send
DO $$ DECLARE q uuid; i uuid; BEGIN
  UPDATE company_settings SET invoice_auto_send_minutes = 0;
  q := mkq('Q-T8','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
  i := create_deposit_invoice_for_quote(q);
  PERFORM ok((SELECT due_at FROM invoice_send_approvals WHERE invoice_id=i) IS NULL,'8 minutes=0 -> no due time');
  PERFORM ok((SELECT body FROM notifications WHERE related_id=i LIMIT 1) LIKE '%Nothing has been sent yet%','8 body says nothing sent');
  UPDATE company_settings SET invoice_auto_send_minutes = 15;
END $$;

-- 9 client online accept: ONE alert per person (invoice alert carries 'accepted online'); old quote_accepted_client not sent
DO $$ DECLARE q uuid; t uuid; i uuid; BEGIN
  INSERT INTO quotes (quote_number,status,company_id,customer_id,customer_name,sales_engineer_id,total,vat_amount,vat_rate,created_by)
  VALUES ('Q-T9','sent','a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','Test Client',
          '11111111-1111-1111-1111-111111111111',1150,150,0.15,'22222222-2222-2222-2222-222222222222') RETURNING id, public_token INTO q, t;
  PERFORM ok(accept_quote_by_token(t, 'Hennie Test', NULL), '9 online accept ok');
  SELECT id INTO i FROM invoices WHERE quote_id=q;
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id IN (q,i))=2, '9 exactly one alert each for rep A + admin A');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM notifications WHERE related_id=q AND type='quote_accepted_client'), '9 old quote_accepted_client not sent');
  PERFORM ok((SELECT bool_and(body LIKE 'Hennie Test accepted online. Invoice INV-%' AND metadata->>'accepted_by'='Hennie Test'
                                AND title='Test Client accepted Q-T9') FROM notifications WHERE related_id=i), '9 alert keeps who/online info');
  PERFORM ok(accept_quote_by_token(t, 'Hennie Test', NULL), '9 re-accept is fine');
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id IN (q,i))=2 AND
             (SELECT count(*) FROM notifications WHERE related_id=i AND body LIKE '%accepted online. %accepted online.%')=0, '9 re-accept adds nothing');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM fake_outbox WHERE invoice_id=i), '9 nothing emailed');
END $$;

-- 10 online accept that creates no invoice (no rep, no creator) still tells admins via the old notice
DO $$ DECLARE q uuid; t uuid; BEGIN
  INSERT INTO quotes (quote_number,status,company_id,customer_id,customer_name,total,vat_amount,vat_rate)
  VALUES ('Q-T10','viewed','a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','Test Client',1150,150,0.15) RETURNING id, public_token INTO q, t;
  PERFORM accept_quote_by_token(t, 'X', NULL);
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id=q AND type='quote_accepted_client')=1, '10 no invoice -> old accepted notice to admin');
END $$;
