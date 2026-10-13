create schema if not exists backup_inherit_20261013;
create table backup_inherit_20261013.companies as select * from public.companies;
create table backup_inherit_20261013.company_settings as select * from public.company_settings;
create table backup_inherit_20261013.company_profiles as select * from public.company_profiles;
create table backup_inherit_20261013.company_network_members as select * from public.company_network_members;
create table backup_inherit_20261013.policies as select * from pg_policies where schemaname='public' and tablename in ('notification_settings','quote_templates','quote_template_items','proposal_templates','install_templates','invoice_templates','visual_proposal_templates');
create table backup_inherit_20261013.guard_fn as select pg_get_functiondef('public.guard_company_tech_pay_settings'::regproc) def;
revoke all on schema backup_inherit_20261013 from public, anon, authenticated;
select (select count(*) from backup_inherit_20261013.companies) c,(select count(*) from backup_inherit_20261013.company_settings) s,(select count(*) from backup_inherit_20261013.company_profiles) p,(select count(*) from backup_inherit_20261013.policies) pol;
