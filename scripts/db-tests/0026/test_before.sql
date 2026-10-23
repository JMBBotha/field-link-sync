\set ON_ERROR_STOP 1
-- fixtures (same as 0025) + helper
INSERT INTO companies (id,name,is_master) VALUES ('a0000000-0000-0000-0000-00000000000a','Massair CT',true),('b0000000-0000-0000-0000-00000000000b','Other Co',false);
INSERT INTO profiles VALUES ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-00000000000a','Rep A'),
 ('22222222-2222-2222-2222-222222222222','a0000000-0000-0000-0000-00000000000a','Admin A'),
 ('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-00000000000b','Admin B');
INSERT INTO user_roles (user_id,role) VALUES ('22222222-2222-2222-2222-222222222222','admin'),('33333333-3333-3333-3333-333333333333','admin'),
 ('11111111-1111-1111-1111-111111111111','field_agent');
INSERT INTO company_settings (company_id,is_primary) VALUES ('a0000000-0000-0000-0000-00000000000a',true);
INSERT INTO customers (id,name,email) VALUES ('c0000000-0000-0000-0000-000000000001','Test Client','test@example.invalid');
SELECT setval('invoice_number_seq', 41, true);
CREATE FUNCTION ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; RAISE NOTICE 'PASS: %', msg; END $$;
-- quote in 'sent' state; total so that the 70% deposit is 27 421,32
CREATE FUNCTION mkq(n text, lead uuid DEFAULT 'eeeeeeee-0000-0000-0000-000000000001', tot numeric DEFAULT 39173.32) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO quotes (quote_number,status,company_id,customer_id,customer_name,lead_id,sales_engineer_id,total,vat_amount,vat_rate,created_by)
  VALUES (n,'sent','a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','Test Client',lead,
          '11111111-1111-1111-1111-111111111111',tot,tot*15/115,0.15,'22222222-2222-2222-2222-222222222222') RETURNING id $$;
-- all notices about one accept (quote or its invoices)
CREATE FUNCTION accept_notices(q uuid) RETURNS SETOF notifications LANGUAGE sql AS $$
  SELECT * FROM notifications WHERE related_id = q OR related_id IN (SELECT id FROM invoices WHERE quote_id = q) $$;

-- B0 baseline (0025 only, live today): staff accept gives the rep THREE notices
DO $$ DECLARE q uuid := mkq('Q-B0'); BEGIN
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')=3,
    'B0 before 0026: rep gets 3 notices (invoice alert + hand to technician + Quote Accepted)');
  PERFORM ok((SELECT body FROM accept_notices(q) WHERE type='quote_accepted_send_invoice' LIMIT 1) LIKE '%(deposit R 27421.32)%',
    'B0 before 0026: deposit shown as R 27421.32');
END $$;
