-- Rollback for 20261020130000_invoice_followups.sql
-- 1) Remove the hook from process_sales_escalations
do $do$ declare d text; begin
  select pg_get_functiondef('public.process_sales_escalations()'::regprocedure) into d;
  d := replace(d, E'  perform public.process_invoice_followups();\n', ''); execute d; end $do$;
-- 2) Restore old pf_decide / pf_claim_send / pf_flag_overdue: re-run their definitions saved in
--    docs/db-releases/2026-10-20_invoice_followups_before.sql (captured live before apply).
drop function if exists public.pf_decide(uuid, boolean, text, text, text);
\i docs/db-releases/2026-10-20_invoice_followups_before.sql
-- 3) Drop new helpers
drop function if exists public.invoice_due_summary();
drop function if exists public.process_invoice_followups();
drop function if exists public._inv_step(uuid,int);
drop function if exists public._inv_subject(text,text);
drop function if exists public._inv_message(text,text,text,numeric,date,text);
drop function if exists public._inv_rep(uuid);
drop function if exists public._inv_due(date,date,timestamptz);
-- 4) Data/constraints (new step rows cancelled, then constraints back)
update public.payment_followups set status = 'cancelled', decision_note = 'rollback' where step is not null and status in ('pending','approved');
delete from public.payment_followups where stage not in (0,3,7);
drop index if exists public.payment_followups_invoice_step_uq;
alter table public.payment_followups drop constraint if exists payment_followups_step_check;
alter table public.payment_followups drop constraint if exists payment_followups_stage_check;
alter table public.payment_followups add constraint payment_followups_stage_check check (stage in (0,3,7));
alter table public.payment_followups alter column channel set default 'whatsapp';
alter table public.payment_followups drop column if exists step, drop column if exists subject;
delete from public.sales_escalations where entity_type = 'invoice';
alter table public.sales_escalations drop constraint if exists sales_escalations_entity_type_check;
alter table public.sales_escalations add constraint sales_escalations_entity_type_check check (entity_type in ('lead','quote','job'));
