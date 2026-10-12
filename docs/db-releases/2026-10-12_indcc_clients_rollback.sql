-- Rollback Ind CC client-record import batch 1 (13 clients, 12 Oct 2026). Contacts cascade.
begin;
delete from public.customers where id in (select id from backup_ct_20261012.import_manifest where tbl='customers' and ref like 'FreshBooks Ind CC%');
delete from backup_ct_20261012.import_manifest where ref like 'FreshBooks Ind CC%';
-- PGE Construction (created 15:12, filled from Ind CC 204931): previous state in backup_ct_20261012.pge_before
commit;
