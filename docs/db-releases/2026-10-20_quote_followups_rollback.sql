-- Rollback quote follow-ups (20 Oct). Restores 11:50 dismiss/close/restore functions by re-running the earlier migration's function blocks.
select cron.unschedule('quote-followups') where exists (select 1 from cron.job where jobname = 'quote-followups');
drop function if exists public.process_quote_followups();
drop function if exists public.log_quote_followup(uuid,text,timestamptz,text);
drop trigger if exists quotes_followup_on_send on public.quotes;
drop function if exists public._quote_followup_on_send();
drop function if exists public._quote_is_visit(uuid);
drop table if exists public.quote_followups;
alter table public.quotes drop column if exists followup_kind, drop column if exists followup_state, drop column if exists followup_count, drop column if exists followup_next_at;
-- Then re-apply dismiss_lead / close_lead / restore_lead from supabase/migrations/20261020120000_lead_dismiss_close.sql (admin/dispatcher rules), and:
-- drop function if exists public.can_close_lead(uuid);
