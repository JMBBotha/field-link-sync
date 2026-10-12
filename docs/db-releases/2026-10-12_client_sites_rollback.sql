-- Rollback client_sites + client_type (2026-10-12). Nothing else touched.
begin;
drop table if exists public.client_sites;
drop function if exists public.client_sites_sync_company();
alter table public.customers drop constraint if exists customers_client_type_check;
alter table public.customers drop column if exists client_type;
commit;
-- Optional: remove client created 15:12 on Johan's request (PGE Construction + contact Josh)
-- delete from public.customers where id='02790513-dee6-40e6-8018-600963f6eb40';  -- cascades to client_contacts 5046ba43
