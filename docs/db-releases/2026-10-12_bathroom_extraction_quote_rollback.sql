-- Rollback: draft quote Q-2026-0034 (bathroom extraction, CAPE ESTATES PAARL), company 361bf031 MASSAIR CT, 2026-10-12
-- Created via app numbering path (trg_auto_assign_quote_number -> generate_quote_number(company_id)).
-- Pre-change: company_quote_counters had NO row for 361bf031 (snapshot: backup_bathq_20261012.company_quote_counters, empty).
begin;
delete from public.quote_items where quote_id='b47a0e11-2d7c-4c3e-9a51-0b1e2a7f1012';
delete from public.quotes where id='b47a0e11-2d7c-4c3e-9a51-0b1e2a7f1012' and quote_number='Q-2026-0034';
delete from public.company_quote_counters where company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
  and not exists (select 1 from backup_bathq_20261012.company_quote_counters);
commit;
