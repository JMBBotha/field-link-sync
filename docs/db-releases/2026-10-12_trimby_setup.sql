DO $$
DECLARE c uuid := '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'; v_cust uuid; v_loc uuid; v_inv uuid; v_item uuid; v_pay uuid; v_job uuid;
  v_addr text := '5 Bright Str, Somerset West, 7130';
BEGIN
  IF EXISTS (SELECT 1 FROM customers WHERE company_id = c AND (name ILIKE '%trimby%' OR company_name ILIKE '%trimby%')) THEN RAISE EXCEPTION 'Trimby client exists'; END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE company_id = c AND invoice_number = '0001776') THEN RAISE EXCEPTION 'Invoice 0001776 exists'; END IF;
  PERFORM set_config('app.invoice_skip_email', 'on', true);
  INSERT INTO customers (name, company_name, is_company, client_type, phone, address, primary_address_line1, city, postal_code, area, vat_number, company_id, status, lead_source, notes)
  VALUES ('Steve Trimby Optometrists', 'Steve Trimby Optometrists', true, 'company', 'N/A', v_addr, '5 Bright Str', 'Somerset West', '7130', 'Somerset West', '4300309442', c, 'active', 'manual',
          'Phone and email not supplied at setup (12 Oct 2026).')
  RETURNING id INTO v_cust;
  INSERT INTO customer_locations (customer_id, company_id, label, address, is_primary) VALUES (v_cust, c, 'Main', v_addr, true) RETURNING id INTO v_loc;
  INSERT INTO invoices (invoice_number, agent_id, customer_name, customer_phone, customer_address, customer_id, location_id, company_id, company_profile_id, billed_to_vat_number,
     line_items, subtotal, tax_rate, tax_amount, grand_total, payment_method, status, issue_date, due_date, sent_at, notes)
  VALUES ('0001776', '1e795a9b-f8bd-4af5-8f28-5e0426101daa', 'Steve Trimby Optometrists', NULL, v_addr, v_cust, v_loc, c, '8ebd6434-3fca-5a8d-8476-270e994dcb46', '4300309442',
     jsonb_build_array(jsonb_build_object('name','Samsung AR09BSHGAWK/FA','description','Samsung AR4500 9000 BTU Inverter wall split (AR09BSHGAWK/FA)','quantity',1,'rate',12864.00,'amount',12864.00,'vat_rate',15)),
     12864.00, 15, 1929.60, 14793.60, 'eft', 'draft', '2026-10-12', '2026-10-12', NULL, NULL)
  RETURNING id INTO v_inv;
  INSERT INTO invoice_items (invoice_id, description, line_name, line_type, quantity, unit_price, amount, vat_rate, sort_order, product_id)
  VALUES (v_inv, 'Samsung AR4500 9000 BTU Inverter wall split (AR09BSHGAWK/FA)', 'Samsung AR09BSHGAWK/FA', 'unit', 1, 12864.00, 12864.00, 15, 0, '17703fff-cd41-4ec5-980b-4bc5eeec6529')
  RETURNING id INTO v_item;
  -- draft -> sent without client email (skip flag on), then the payment makes it paid
  UPDATE invoices SET status = 'sent', sent_at = now() WHERE id = v_inv;
  INSERT INTO payments (invoice_id, amount, payment_date, method, reference, gateway, gateway_reference, status, environment, currency, company_id, created_by, raw_payload)
  VALUES (v_inv, 14793.60, '2026-10-12', 'eft', '1776', 'manual', 'eft:0001776:2026-10-12:14793.60', 'paid', 'live', 'ZAR', c, '1e795a9b-f8bd-4af5-8f28-5e0426101daa',
          jsonb_build_object('source','manual_setup','bank_match_key','eft:0001776:2026-10-12:14793.60','note','Recorded manually; link the bank statement line to THIS payment (Bank page: Linked to payment), do not record a new one.'))
  RETURNING id INTO v_pay;
  INSERT INTO jobs (company_id, customer_id, location_id, invoice_id, title, description, address, job_type, status, priority, scheduled_for, awaiting_stock)
  VALUES (c, v_cust, v_loc, v_inv, 'Install Samsung AR09BSHGAWK/FA - Steve Trimby Optometrists', 'Waiting for stock (invoice 0001776 paid 12 Oct 2026). No date or technician yet.', v_addr,
          'installation', 'scheduled', 'normal', NULL, true)
  RETURNING id INTO v_job;
  RAISE NOTICE 'cust % loc % inv % item % pay % job %', v_cust, v_loc, v_inv, v_item, v_pay, v_job;
END $$;
