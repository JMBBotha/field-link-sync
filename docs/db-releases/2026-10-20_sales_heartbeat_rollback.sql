-- Rollback for 20261020110000_sales_heartbeat.sql
select cron.unschedule('sales-heartbeat-escalations') where exists (select 1 from cron.job where jobname = 'sales-heartbeat-escalations');
drop function if exists public.process_sales_escalations();
drop function if exists public._hb_nudge(uuid,text,uuid,text,int,uuid[],text,text);
drop function if exists public._hb_dispatch(uuid);
drop function if exists public._hb_sales(uuid);
drop function if exists public._hb_admins(uuid);
drop function if exists public._hb_limit(uuid,text,numeric);
drop function if exists public.acknowledge_lead(uuid);
drop table if exists public.sales_escalations;
alter table public.company_settings drop column if exists sales_stage_limits;
alter table public.leads drop column if exists visit_booked_at;
alter table public.leads drop column if exists acknowledged_by;
alter table public.leads drop column if exists acknowledged_at;
