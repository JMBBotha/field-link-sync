-- Rollback for Ind CC client list apply (12 Oct 2026, Johan voice 15:35). Client records only.
-- Restores the 7 removed clients (UBUD, The 78 Partnership, Agrovic, Kempster Sedgwick, Ventro Prop, Andre Hugo, Brick Art)
-- from backup_ct_20261012.indcc_removed7_*, and deletes the 4 added (HEPRO Cape, NuBerry Fruits, Stellenbosch Nano Fibre, Lantern Engineering).
begin;
-- remove the 4 added (contacts cascade)
delete from public.customers where company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' and id in (
 'd5bca105-4ce2-5754-9260-ec04c1c27d93', -- HEPRO Cape (FB 35)
 'a44820fa-d892-5ba2-9918-5bc382114a4e', -- NuBerry Fruits (FB 725)
 '1735918c-eb1c-5818-84a9-e59bcf206237', -- Stellenbosch Nano Fibre (FB 60354)
 'a549680c-fece-514e-9880-2f767a742f06'  -- Lantern Engineering (FB 193730)
);
delete from backup_ct_20261012.import_manifest where id in ('d5bca105-4ce2-5754-9260-ec04c1c27d93','a44820fa-d892-5ba2-9918-5bc382114a4e','1735918c-eb1c-5818-84a9-e59bcf206237','a549680c-fece-514e-9880-2f767a742f06');
-- restore the 7 removed
insert into public.customers select * from backup_ct_20261012.indcc_removed7_customers on conflict (id) do nothing;
insert into public.client_contacts select * from backup_ct_20261012.indcc_removed7_contacts on conflict (id) do nothing;
insert into public.client_sites select * from backup_ct_20261012.indcc_removed7_sites on conflict (id) do nothing;
insert into backup_ct_20261012.import_manifest select * from backup_ct_20261012.indcc_removed7_manifest m where not exists (select 1 from backup_ct_20261012.import_manifest x where x.id=m.id);
commit;
