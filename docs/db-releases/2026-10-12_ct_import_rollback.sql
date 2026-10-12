-- Rollback CT import 2026-10-12 (run as one transaction)
begin;
select set_config('app.invoice_unlock','on',true), set_config('app.invoice_skip_email','on',true);
delete from public.payments where id in (select id from backup_ct_20261012.import_manifest where tbl='payments');
delete from public.invoice_items where invoice_id in (select id from backup_ct_20261012.import_manifest where tbl='invoices');
delete from public.invoices where id in (select id from backup_ct_20261012.import_manifest where tbl='invoices');
delete from public.quote_items where quote_id in (select id from backup_ct_20261012.import_manifest where tbl='quotes');
delete from public.quotes where id in (select id from backup_ct_20261012.import_manifest where tbl='quotes');
delete from public.customers where id in (select id from backup_ct_20261012.import_manifest where tbl='customers');
delete from public.company_profiles where id in (select id from backup_ct_20261012.import_manifest where tbl='company_profiles');
update public.companies c set name=b.name from backup_ct_20261012.companies b where c.id=b.id;
insert into public.customers select * from backup_ct_20261012.customers on conflict do nothing;
insert into public.leads select * from backup_ct_20261012.leads on conflict do nothing;
insert into public.notification_queue select * from backup_ct_20261012.notification_queue on conflict do nothing;
-- optional: drop contacts feature
-- drop table public.client_contacts; drop function public.client_contacts_sync_company();
commit;
-- Catalogue backup (only if ever needed): backup_ct_20261012.supplier_products / price_list_uploads / catalog_services
