-- Clients list V8 (Johan approved 20 Oct 14:03): per-client sites count + last activity, and quotes needing a follow-up.
-- SECURITY INVOKER: runs under the caller's RLS, so company scoping and "reps see only their own" stay exactly as today.
-- Rollback: docs/db-releases/2026-10-20_client_list_stats_rollback.sql
create or replace function public.client_list_stats() returns table (customer_id uuid, sites int, last_activity timestamptz)
language sql stable security invoker set search_path = public as $$
  select c.id,
    (select count(*)::int from public.customer_locations l where l.customer_id = c.id),
    greatest(c.updated_at,
      (select max(n.created_at) from public.customer_notes n where n.customer_id = c.id),
      (select max(v.created_at) from public.vapi_calls v where v.customer_id = c.id),
      (select max(q.updated_at) from public.quotes q where q.customer_id = c.id),
      (select max(j.updated_at) from public.jobs j where j.customer_id = c.id),
      (select max(i.updated_at) from public.invoices i where i.customer_id = c.id),
      (select max(coalesce(p.sent_at, p.created_at)) from public.payment_followups p where p.customer_id = c.id))
  from public.customers c $$;
grant execute on function public.client_list_stats() to authenticated;

create or replace function public.quotes_followup_due_count() returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.quotes q
  where q.followup_state is not null and q.followup_state <> 'closed' and q.followup_next_at is not null
    and q.followup_next_at < (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '2 day') at time zone 'Africa/Johannesburg' $$;
grant execute on function public.quotes_followup_due_count() to authenticated;
