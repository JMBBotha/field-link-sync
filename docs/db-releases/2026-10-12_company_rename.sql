-- Johan 2026-10-12 20:47: company name is ALWAYS 'Massair CT (Pty) Ltd' (company 361bf031 only)
begin;
update companies set name='Massair CT (Pty) Ltd' where id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
update company_profiles set legal_name='Massair CT (Pty) Ltd', account_name='Massair CT (Pty) Ltd',
  terms_text=regexp_replace(terms_text,'Massair CT Pty Limited|MASSAIR CT PTY LTD|Massair CT Pty Ltd|MASSAIR CT \(PTY\) Ltd','Massair CT (Pty) Ltd','gi')
  where id='8ebd6434-3fca-5a8d-8476-270e994dcb46' and company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
update company_settings set company_name='Massair CT (Pty) Ltd',
  banking_details=jsonb_set(banking_details,'{account_name}','"Massair CT (Pty) Ltd"')
  where id='a70c9005-45a7-444a-8b49-249a83b490b0' and company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
update quotes set terms_text=regexp_replace(terms_text,'Massair CT Pty Limited|MASSAIR CT PTY LTD|Massair CT Pty Ltd|MASSAIR CT \(PTY\) Ltd','Massair CT (Pty) Ltd','gi')
  where company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' and terms_text ~* 'massair ct';
update invoices set profile_snapshot=regexp_replace(profile_snapshot::text,'Massair CT Pty Limited|MASSAIR CT PTY LTD|Massair CT Pty Ltd|MASSAIR CT \(PTY\) Ltd','Massair CT (Pty) Ltd','gi')::jsonb
  where company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' and profile_snapshot::text ~* 'massair ct';
commit;
