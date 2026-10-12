begin;
create schema if not exists backup_ct_20261012;
create table backup_ct_20261012.supplier_products as select * from public.supplier_products;
create table backup_ct_20261012.price_list_uploads as select * from public.price_list_uploads;
create table backup_ct_20261012.catalog_services as select * from public.catalog_services;
create table backup_ct_20261012.companies as select * from public.companies where id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
create table backup_ct_20261012.company_profiles as select * from public.company_profiles where company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
create table backup_ct_20261012.customers as select * from public.customers where id='0de191d3-111c-45c8-92e4-3c8a86fa21ca';
create table backup_ct_20261012.leads as select * from public.leads where id='c1a29087-87cd-4cfe-bebe-7c74e07983e9';
create table backup_ct_20261012.notification_queue as select * from public.notification_queue where lead_id='c1a29087-87cd-4cfe-bebe-7c74e07983e9' or customer_id='0de191d3-111c-45c8-92e4-3c8a86fa21ca';
create table backup_ct_20261012.import_manifest(tbl text, id uuid, ref text);
update public.companies set name='MASSAIR CT PTY LTD' where id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
insert into public.company_profiles(id,company_id,legal_name,trading_name,vat_number,phone,email,address_lines,bank_name,account_name,account_number,branch_code,account_type,terms_text,invoice_prefix,use_shared_sequence,next_invoice_no,number_pad,is_default)
values ('8ebd6434-3fca-5a8d-8476-270e994dcb46','361bf031-9cdb-4d7f-9bde-9eb95fa4725e','MASSAIR CT PTY LTD','0800-BE-COOL','4630313080','(021) 802 2889','info@0800becool.co.za',array['9A Cabernet Rd','Blackheath','Cape Town','7580'],'FNB','MASSAIR CT PTY LTD','63226563591','250655','Cheque','BANKING DETAILS: 
6.1 Account Name: MASSAIR CT PTY LTD
6.2 Bank: FNB
6.3 Account Type: Cheque Account
6.4 Account Number: 63226563591
6.5 Branch Code: [250 655]

WARRANTY: One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.

TERMS OF PAYMENT:Unless previously arranged with management it will be assumed that you the client will be responsible for payment. All goods remain the property of MASSAIR CT PTY LTD until paid in full.','',false,10017,7,true);
insert into backup_ct_20261012.import_manifest values ('company_profiles','8ebd6434-3fca-5a8d-8476-270e994dcb46','MASSAIR CT profile');
delete from public.notification_queue where lead_id='c1a29087-87cd-4cfe-bebe-7c74e07983e9' or customer_id='0de191d3-111c-45c8-92e4-3c8a86fa21ca';
delete from public.leads where id='c1a29087-87cd-4cfe-bebe-7c74e07983e9';
delete from public.customers where id='0de191d3-111c-45c8-92e4-3c8a86fa21ca';
commit;
