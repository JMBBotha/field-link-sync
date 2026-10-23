\set ON_ERROR_STOP 1
DO $$ BEGIN PERFORM ok(fmt_rand_sql(27421.32)='R 27 421,32' AND fmt_rand_sql(805)='R 805,00' AND fmt_rand_sql(1234567.5)='R 1 234 567,50','F format helper'); END $$;

-- 1 staff accept with a visit: ONE alert per person, SA format, hand-to-technician link kept
DO $$ DECLARE q uuid := mkq('Q-A1'); n record; BEGIN
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')=1,'1 rep gets exactly 1 notice');
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE user_id='22222222-2222-2222-2222-222222222222')=1,'1 admin gets exactly 1 notice');
  PERFORM ok(NOT EXISTS (SELECT 1 FROM accept_notices(q) WHERE type IN ('quote_accepted_handover','quote_status_change')),'1 no old handover / Quote Accepted notices');
  SELECT * INTO n FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111';
  PERFORM ok(n.type='quote_accepted_send_invoice' AND n.title='Test Client accepted Q-A1','1 it is the invoice alert');
  PERFORM ok(n.body LIKE 'Invoice INV-% (deposit R 27 421,32) is ready.%','1 body deposit = "R 27 421,32": '||n.body);
  PERFORM ok(n.metadata->>'handover_link'='/admin/visits/eeeeeeee-0000-0000-0000-000000000001' AND n.metadata->>'lead_id'='eeeeeeee-0000-0000-0000-000000000001','1 handover link to the visit kept');
  PERFORM ok((SELECT count(*) FROM invoice_send_approvals WHERE quote_id=q)=1 AND NOT EXISTS (SELECT 1 FROM fake_outbox),'1 one approval, nothing emailed');
END $$;

-- 2 no visit -> link to the estimate (same as the old notice)
DO $$ DECLARE q uuid := mkq('Q-A2', NULL); BEGIN
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT metadata->>'handover_link' FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')='/admin/estimates/'||q,'2 no visit -> estimate link');
  PERFORM ok((SELECT count(*) FROM accept_notices(q))=2,'2 one each for rep + admin');
END $$;

-- 3 installation job already exists -> no handover link (old notice would also not fire)
DO $$ DECLARE q uuid := mkq('Q-A3'); BEGIN
  INSERT INTO jobs (quote_id, job_type) VALUES (q, 'installation');
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM accept_notices(q))=2 AND (SELECT bool_and(metadata->>'handover_link' IS NULL) FROM accept_notices(q)),'3 has job -> 1 each, no handover link');
END $$;

-- 4 client online accept: still one alert each, carries 'accepted online' + link
DO $$ DECLARE q uuid := mkq('Q-A4'); t uuid; BEGIN
  SELECT public_token INTO t FROM quotes WHERE id=q;
  PERFORM ok(accept_quote_by_token(t,'Hennie Test',NULL),'4 online accept ok');
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')=1
         AND (SELECT count(*) FROM accept_notices(q))=2,'4 one alert each (rep + admin)');
  PERFORM ok((SELECT bool_and(body LIKE 'Hennie Test accepted online. Invoice INV-% (deposit R 27 421,32)%' AND metadata->>'handover_link' LIKE '/admin/visits/%') FROM accept_notices(q)),'4 online text + SA format + link');
END $$;

-- 5 other status changes are unchanged
DO $$ DECLARE q uuid := mkq('Q-A5'); BEGIN
  UPDATE quotes SET status='viewed' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id=q AND type='quote_status_change' AND title='Quote Viewed')=1,'5 "Quote Viewed" still sent');
END $$;

-- 6 fallback: accept that creates no invoice (variation) keeps the old 'Quote Accepted' notice
DO $$ DECLARE q uuid := mkq('Q-A6'); BEGIN
  UPDATE quotes SET is_variation=true WHERE id=q;
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok(NOT EXISTS (SELECT 1 FROM invoices WHERE quote_id=q),'6 variation -> no invoice');
  PERFORM ok((SELECT count(*) FROM notifications WHERE related_id=q AND title='Quote Accepted')=1,'6 fallback "Quote Accepted" still sent');
END $$;

-- 7 two quotes accepted in ONE transaction: each handled on its own
DO $$ DECLARE q1 uuid := mkq('Q-A7a'); q2 uuid := mkq('Q-A7b'); BEGIN
  UPDATE quotes SET status='accepted' WHERE id IN (q1,q2);
  PERFORM ok((SELECT count(*) FROM accept_notices(q1))=2 AND (SELECT count(*) FROM accept_notices(q2))=2,'7 two accepts in one tx -> 1 each per quote');
END $$;

-- 8 later re-accept (accepted -> sent -> accepted, new tx) adds no duplicate alert: approval already exists
DO $$ DECLARE q uuid := (SELECT id FROM quotes WHERE quote_number='Q-A1'); BEGIN
  UPDATE quotes SET status='sent' WHERE id=q;
END $$;
DO $$ DECLARE q uuid := (SELECT id FROM quotes WHERE quote_number='Q-A1'); BEGIN
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE type='quote_accepted_send_invoice')=2,'8 re-accept: no second invoice alert');
END $$;
