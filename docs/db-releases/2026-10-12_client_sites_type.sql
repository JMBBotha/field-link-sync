begin;
alter table public.customers add column if not exists client_type text default null;
alter table public.customers drop constraint if exists customers_client_type_check;
alter table public.customers add constraint customers_client_type_check check (client_type is null or client_type in ('private','company','developer'));
update public.customers set client_type='developer' where id='3dde87f5-60cf-5cda-bc54-edd8b0e553cc' and company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
commit;
