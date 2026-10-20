-- Rollback lead dismiss/close (20 Oct). First put closed/dismissed leads back to their prior status:
update public.leads set status = coalesce(pre_close_status,status), lead_status = coalesce(pre_close_lead_status,lead_status)
 where dismissed_at is not null or closed_at is not null;
do $$ declare d text; begin
  d := pg_get_functiondef('public.process_sales_escalations()'::regprocedure);
  d := replace(d, 'l.deleted_at is null and l.dismissed_at is null and l.closed_at is null', 'l.deleted_at is null');
  execute d; end $$;
drop function if exists public.dismiss_lead(uuid,text);
drop function if exists public.close_lead(uuid,text,text,text);
drop function if exists public.restore_lead(uuid);
drop function if exists public.lead_lost_allowed(uuid);
drop function if exists public._lead_staff_ok();
drop index if exists public.leads_dismissed_idx;
drop trigger if exists leads_mark_followup on public.leads;
drop function if exists public._lead_mark_followup();
alter table public.leads drop column if exists marketing_followup;
alter table public.leads drop column if exists dismissed_at, drop column if exists dismissed_by, drop column if exists dismiss_reason,
  drop column if exists closed_at, drop column if exists closed_by, drop column if exists close_outcome, drop column if exists close_reason,
  drop column if exists close_note, drop column if exists pre_close_status, drop column if exists pre_close_lead_status;
