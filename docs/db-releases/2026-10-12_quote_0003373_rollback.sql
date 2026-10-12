-- Rollback: FreshBooks proposal 0003373 import into Field Lynk (company 361bf031-9cdb-4d7f-9bde-9eb95fa4725e), 2026-10-12
begin;
delete from public.quote_items where quote_id='1bc98aae-ef8f-5143-8d1c-4d4cbe365382';
delete from public.quotes where id='1bc98aae-ef8f-5143-8d1c-4d4cbe365382' and quote_number='0003373';
delete from backup_ct_20261012.import_manifest where id='1bc98aae-ef8f-5143-8d1c-4d4cbe365382';
commit;
-- Pre-change snapshot: backup_q3373_20261012.quotes / quote_items
