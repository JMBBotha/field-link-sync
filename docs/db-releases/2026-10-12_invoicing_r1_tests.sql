DO $t$
DECLARE r jsonb := '{}'; TH uuid := '8fc39364-ce8e-4ac7-9b0a-c14bdc05ac84'; AD uuid := '420c7731-e8a4-4355-80ca-51c684b42a2c';
  CT uuid; IND uuid; src uuid; d uuid; d2 uuid; e text;
BEGIN
  SELECT id INTO CT FROM company_profiles WHERE legal_name ILIKE 'MASSAIR CT%';
  SELECT id INTO IND FROM company_profiles WHERE legal_name ILIKE 'MASSAIR IND%';
  r := r || jsonb_build_object('primary_rows', (SELECT jsonb_agg(left(id::text,8)) FROM company_settings WHERE is_primary));
  r := r || jsonb_build_object('totals_unchanged', (SELECT count(*) FROM invoices i JOIN backup_inv_20261012.invoices b USING (id)
      WHERE (i.subtotal,i.tax_amount,i.grand_total,i.status,i.invoice_number) = (b.subtotal,b.tax_amount,b.grand_total,b.status,b.invoice_number)),
     'profiled', (SELECT count(*) FROM invoices WHERE company_profile_id = CT AND profile_snapshot IS NOT NULL));
  SELECT id INTO src FROM invoices WHERE invoice_number = 'INV-016';
  -- lock: change paid invoice
  BEGIN UPDATE invoices SET subtotal = subtotal + 1 WHERE id = src; r := r || '{"lock_header":"NOT BLOCKED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('lock_header', left(SQLERRM,60)); END;
  BEGIN INSERT INTO invoice_items(invoice_id, description, quantity, unit_price, amount) VALUES (src,'x',1,1,1); r := r || '{"lock_items":"NOT BLOCKED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('lock_items', left(SQLERRM,60)); END;
  -- as admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', AD, 'role','authenticated')::text, true);
  d := duplicate_invoice(src);
  r := r || jsonb_build_object('dup', (SELECT jsonb_build_object('no',invoice_number,'st',status,'tot',grand_total,'prof',company_profile_id=CT,'from',duplicated_from=src,
       'items',(SELECT count(*) FROM invoice_items WHERE invoice_id=d)) FROM invoices WHERE id=d));
  BEGIN INSERT INTO invoice_items(invoice_id, description, quantity, unit_price, amount, vat_rate) VALUES (d,'novat',1,10,10,0); r := r || '{"vat0":"NOT BLOCKED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('vat0', left(SQLERRM,60)); END;
  INSERT INTO invoice_items(invoice_id, line_name, description, quantity, unit_price, amount, line_type, room_label) VALUES (d,'Install','Installation lounge',1,1000,1000,'installation','Lounge');
  r := r || jsonb_build_object('line_vat', (SELECT vat_amount FROM invoice_items WHERE invoice_id=d AND line_name='Install'));
  UPDATE invoices SET deposit_type='percent', deposit_value=50 WHERE id=d;
  r := r || jsonb_build_object('dep50', (SELECT jsonb_build_object('tot',grand_total,'dep',deposit_amount) FROM invoices WHERE id=d));
  r := r || jsonb_build_object('ind_no1', next_invoice_number(IND), 'ind_no2', next_invoice_number(IND), 'ct_no', next_invoice_number(CT));
  UPDATE invoices SET status='sent' WHERE id=d;
  r := r || jsonb_build_object('sent', (SELECT jsonb_build_object('at',sent_at IS NOT NULL,'snap',profile_snapshot->>'legal_name') FROM invoices WHERE id=d));
  BEGIN UPDATE invoices SET status='draft' WHERE id=d; r := r || '{"undraft":"NOT BLOCKED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('undraft', left(SQLERRM,50)); END;
  -- tech
  PERFORM set_config('request.jwt.claims', json_build_object('sub', TH, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r || jsonb_build_object('tech_sees_profiles', (SELECT count(*) FROM company_profiles));
  BEGIN PERFORM duplicate_invoice(src); r := r || '{"tech_dup":"NOT BLOCKED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('tech_dup', left(SQLERRM,40)); END;
  RESET ROLE;
  RAISE EXCEPTION 'RESULT %', r;
END $t$;
