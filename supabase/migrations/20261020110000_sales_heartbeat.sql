-- Sales heartbeat (Johan 20 Oct 10:47). Additive. Rollback: docs/db-releases/2026-10-20_sales_heartbeat_rollback.sql
alter table public.leads add column if not exists acknowledged_at timestamptz;
alter table public.leads add column if not exists acknowledged_by uuid;
alter table public.leads add column if not exists visit_booked_at timestamptz;
alter table public.company_settings add column if not exists sales_stage_limits jsonb;
comment on column public.company_settings.sales_stage_limits is 'Heartbeat stall limits; null = app defaults {leadRepMin:5,leadTeamMin:15,leadOwnerMin:30,contactedDays:1,contactedAdminDays:2,sentDays:2,viewedDays:3,viewedAdminDays:7,acceptedDays:2,acceptedAdminDays:4,depositDays:1,doneDays:7}';

create table if not exists public.sales_escalations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  entity_type text not null check (entity_type in ('lead','quote','job')),
  entity_id uuid not null,
  stage text not null,
  level int not null default 1,
  notified_user_ids uuid[] not null default '{}',
  message text,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, stage, level)
);
create index if not exists sales_escalations_company_idx on public.sales_escalations(company_id, created_at desc);
alter table public.sales_escalations enable row level security;
drop policy if exists "sales_escalations company read" on public.sales_escalations;
create policy "sales_escalations company read" on public.sales_escalations for select to authenticated
  using (company_id = public.caller_company_id() and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'dispatcher')));

-- Acknowledge a hot lead ("I'm on it"). Admin / dispatcher (incl. sales) of the lead's company only; techs cannot.
create or replace function public.acknowledge_lead(p_lead uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz := now();
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'dispatcher')) then raise exception 'Not allowed'; end if;
  update public.leads set acknowledged_at = coalesce(acknowledged_at, v), acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_lead and company_id = public.caller_company_id();
  if not found then raise exception 'Lead not found'; end if;
  return v;
end $$;
grant execute on function public.acknowledge_lead(uuid) to authenticated;

create or replace function public._hb_limit(p_company uuid, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (cs.sales_stage_limits->>p_key)::numeric from public.company_settings cs where cs.company_id = p_company limit 1), p_default)
$$;

create or replace function public._hb_admins(p_company uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct pr.id), '{}') from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
   where pr.company_id = p_company and ur.role = 'admin'
$$;
create or replace function public._hb_sales(p_company uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct pr.id), '{}') from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
   where pr.company_id = p_company and ur.role = 'dispatcher' and pr.dispatch_role in ('sales','sales_engineer')
$$;
create or replace function public._hb_dispatch(p_company uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct pr.id), '{}') from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
   where pr.company_id = p_company and ur.role = 'dispatcher' and coalesce(pr.dispatch_role,'') not in ('sales','sales_engineer')
$$;

-- Log once per (entity, stage, level) and notify in-app (type sales_nudge). No WhatsApp/SMS.
create or replace function public._hb_nudge(p_company uuid, p_type text, p_id uuid, p_stage text, p_level int, p_users uuid[], p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid; v_users uuid[] := array(select distinct x from unnest(p_users) x where x is not null);
begin
  if coalesce(array_length(v_users,1),0) = 0 then return; end if;
  -- Go-live baseline: log existing backlog once without notifying anyone.
  if current_setting('hb.silent', true) = '1' then
    insert into public.sales_escalations(company_id, entity_type, entity_id, stage, level, notified_user_ids, message)
    values (p_company, p_type, p_id, p_stage, p_level, '{}', 'Baseline at go-live (no nudge sent): '||p_body) on conflict do nothing;
    return;
  end if;
  insert into public.sales_escalations(company_id, entity_type, entity_id, stage, level, notified_user_ids, message)
  values (p_company, p_type, p_id, p_stage, p_level, v_users, p_body) on conflict do nothing;
  if not found then return; end if;
  foreach u in array v_users loop
    insert into public.notifications(user_id, type, title, body, related_id, metadata)
    values (u, 'sales_nudge', p_title, p_body, p_id, jsonb_build_object('entity', p_type, 'stage', p_stage, 'level', p_level));
  end loop;
end $$;

create or replace function public.process_sales_escalations() returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_now timestamptz := now(); v_local timestamp := (now() at time zone 'Africa/Johannesburg');
  v_open boolean := extract(isodow from v_local) between 1 and 5 and v_local::time between '08:00' and '17:00';
  m numeric;
begin
  -- New lead, not contacted, not acknowledged (business hours only): 5 min rep, 15 min all sales + admin, 30 min owner/admin
  if v_open then
  for r in select l.id, l.company_id, l.customer_name, l.assigned_agent_id, extract(epoch from v_now - l.created_at)/60 as mins
    from public.leads l where l.status = 'pending' and l.first_contact_at is null and l.acknowledged_at is null
      and l.deleted_at is null and l.merged_into_id is null and l.primary_intent is distinct from 'service'
      and l.created_at > v_now - interval '3 days' loop
    if r.mins >= public._hb_limit(r.company_id,'leadRepMin',5) then
      perform public._hb_nudge(r.company_id,'lead',r.id,'new',1, array[r.assigned_agent_id] || public._hb_sales(r.company_id), 'Hot lead waiting', coalesce(r.customer_name,'New lead')||' not contacted yet'); end if;
    if r.mins >= public._hb_limit(r.company_id,'leadTeamMin',15) then
      perform public._hb_nudge(r.company_id,'lead',r.id,'new',2, public._hb_sales(r.company_id) || public._hb_admins(r.company_id), 'Hot lead overdue', coalesce(r.customer_name,'New lead')||' waiting '||round(r.mins)||' min'); end if;
    if r.mins >= public._hb_limit(r.company_id,'leadOwnerMin',30) then
      perform public._hb_nudge(r.company_id,'lead',r.id,'new',3, public._hb_admins(r.company_id), 'Hot lead: 30 min, nobody responded', coalesce(r.customer_name,'New lead')||' still waiting'); end if;
  end loop;
  end if;
  -- Contacted, no visit booked, no quote
  for r in select l.id, l.company_id, l.customer_name, l.assigned_agent_id, extract(epoch from v_now - l.first_contact_at)/86400 as d
    from public.leads l where l.status = 'pending' and l.first_contact_at is not null and l.visit_booked_at is null
      and l.deleted_at is null and l.merged_into_id is null and l.primary_intent is distinct from 'service'
      and not exists (select 1 from public.quotes q where q.lead_id = l.id) and l.first_contact_at > v_now - interval '30 days' loop
    if r.d >= public._hb_limit(r.company_id,'contactedDays',1) then perform public._hb_nudge(r.company_id,'lead',r.id,'contacted',1, array[r.assigned_agent_id], 'Book the visit', coalesce(r.customer_name,'Lead')||' contacted, no visit booked'); end if;
    if r.d >= public._hb_limit(r.company_id,'contactedAdminDays',2) then perform public._hb_nudge(r.company_id,'lead',r.id,'contacted',2, public._hb_admins(r.company_id), 'Lead stalled', coalesce(r.customer_name,'Lead')||' contacted '||floor(r.d)||' d ago, no visit'); end if;
  end loop;
  -- Quotes
  for r in select q.id, q.company_id, coalesce(q.customer_name, q.quote_number, 'Quote') as n, q.sales_engineer_id, q.status, q.sent_at, q.viewed_at, q.accepted_at,
      exists (select 1 from public.invoices i where i.quote_id = q.id and i.status in ('paid','partially_paid')) as paid,
      exists (select 1 from public.jobs j where j.quote_id = q.id and j.status not in ('cancelled')) as has_job
    from public.quotes q where q.status in ('sent','viewed','accepted') and q.updated_at > v_now - interval '60 days' loop
    if r.status = 'sent' and r.viewed_at is null and r.sent_at < v_now - make_interval(days => public._hb_limit(r.company_id,'sentDays',2)::int) then
      perform public._hb_nudge(r.company_id,'quote',r.id,'sent',1, array[r.sales_engineer_id], 'Quote not opened', r.n||' sent, not viewed'); end if;
    if r.status = 'viewed' or (r.status = 'sent' and r.viewed_at is not null) then
      if r.viewed_at < v_now - make_interval(days => public._hb_limit(r.company_id,'viewedDays',3)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'viewed',1, array[r.sales_engineer_id], 'Follow up quote', r.n||' viewed, no answer'); end if;
      if r.viewed_at < v_now - make_interval(days => public._hb_limit(r.company_id,'viewedAdminDays',7)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'viewed',2, public._hb_admins(r.company_id), 'Quote stalled', r.n||' viewed over a week ago, no answer'); end if;
    end if;
    if r.status = 'accepted' and not r.paid and r.accepted_at is not null then
      if r.accepted_at < v_now - make_interval(days => public._hb_limit(r.company_id,'acceptedDays',2)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'accepted',1, array[r.sales_engineer_id], 'Deposit outstanding', r.n||' accepted, no deposit'); end if;
      if r.accepted_at < v_now - make_interval(days => public._hb_limit(r.company_id,'acceptedAdminDays',4)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'accepted',2, public._hb_admins(r.company_id), 'Deposit stalled', r.n||' accepted, still no deposit'); end if;
    end if;
    if r.status = 'accepted' and r.paid and not r.has_job and coalesce(r.accepted_at, v_now) < v_now - make_interval(days => public._hb_limit(r.company_id,'depositDays',1)::int) then
      perform public._hb_nudge(r.company_id,'quote',r.id,'deposit',1, public._hb_dispatch(r.company_id) || public._hb_admins(r.company_id), 'Book the install', r.n||' deposit in, no install booked'); end if;
  end loop;
  -- Install done, not paid
  for r in select j.id, j.company_id, coalesce(j.title,'Job') as n from public.jobs j
    where j.quote_id is not null and j.status = 'completed' and j.completed_at < v_now - make_interval(days => public._hb_limit(j.company_id,'doneDays',7)::int)
      and j.completed_at > v_now - interval '60 days'
      and not exists (select 1 from public.invoices i where i.quote_id = j.quote_id and i.status = 'paid' and coalesce(i.notes,'') not like 'DEPOSIT%') loop
    perform public._hb_nudge(r.company_id,'job',r.id,'done',1, public._hb_admins(r.company_id), 'Get paid', r.n||' finished, not paid in full');
  end loop;
end $$;

-- Baseline existing backlog silently, then schedule.
select set_config('hb.silent','1',false); select public.process_sales_escalations(); select set_config('hb.silent','0',false);
select cron.unschedule('sales-heartbeat-escalations') where exists (select 1 from cron.job where jobname = 'sales-heartbeat-escalations');
select cron.schedule('sales-heartbeat-escalations', '*/2 * * * *', 'select public.process_sales_escalations()');
