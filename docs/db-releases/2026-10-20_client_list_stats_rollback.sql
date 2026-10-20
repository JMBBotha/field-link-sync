-- Rollback for 20261020143000_client_list_stats.sql
drop function if exists public.client_list_stats();
drop function if exists public.quotes_followup_due_count();
