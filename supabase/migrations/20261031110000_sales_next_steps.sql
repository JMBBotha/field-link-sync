-- Sales "Next steps" (Johan 31 Oct 2026): one server calculation for the to-do panel on Sales + Admin home.
-- Rules: new_lead, no_quote, followup (7 days), cold (30 days, auto), deposit_invoice, book_install (deposit paid in full),
-- assign_tech, final_invoice / final_unpaid (+2 days after completion).
-- Quote aging: Cold at 30 days, auto-archive Cold at 60 days (archived_at, never deleted). Runs once a day from the
-- existing 'quote-followups' cron, but ONLY when sales_automation_settings.quote_aging_enabled = true (default false).

alter table public.quotes add column if not exists aging_state text check (aging_state is null or aging_state in ('cold'));
alter table public.quotes add column if not exists aging_at timestamptz;

create table if not exists public.sales_automation_settings (
  company_id uuid primary key,
  quote_aging_enabled boolean not null default false,
  cold_after_days int not null default 30,
  archive_after_days int not null default 60,
  last_aging_run date,
  updated_at timestamptz not null default now()
);
alter table public.sales_automation_settings enable row level security;
drop policy if exists sas_read on public.sales_automation_settings;
create policy sas_read on public.sales_automation_settings for select to authenticated
  using (company_id = public.get_user_company_id(auth.uid()));

create table if not exists public.quote_aging_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid, quote_id uuid not null, action text not null check (action in ('cold','archived','undo')),
  prev_aging_state text, prev_archived_at timestamptz, created_at timestamptz not null default now()
);
alter table public.quote_aging_log enable row level security;
drop policy if exists qal_read on public.quote_aging_log;
create policy qal_read on public.quote_aging_log for select to authenticated
  using (company_id = public.get_user_company_id(auth.uid()));

create table if not exists public.next_step_snoozes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  rule text not null check (rule <> 'new_lead'),
  entity_type text not null,
  entity_id uuid not null,
  snoozed_until timestamptz,
  dismissed boolean not null default false,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
create index if not exists next_step_snoozes_entity_idx on public.next_step_snoozes(entity_id, rule) where cleared_at is null;
alter table public.next_step_snoozes enable row level security;
drop policy if exists nss_read on public.next_step_snoozes;
create policy nss_read on public.next_step_snoozes for select to authenticated
  using (company_id = public.get_user_company_id(auth.uid()));

-- Which quotes would turn Cold / be archived (dry run = no writes).
create or replace function public.quote_aging_candidates(p_company uuid default null)
returns table(company_id uuid, quote_id uuid, quote_number text, sent_at timestamptz, days_since_sent int, action text)
language sql stable security definer set search_path to 'public' as $$
  select q.company_id, q.id, q.quote_number, q.sent_at, (current_date - q.sent_at::date)::int,
         case when (current_date - q.sent_at::date) >= coalesce(s.archive_after_days,60) then 'archive' else 'cold' end
  from public.quotes q left join public.sales_automation_settings s on s.company_id = q.company_id
  where q.archived_at is null and q.sent_at is not null and q.status in ('sent','viewed')
    and coalesce(q.is_variation,false) = false
    and (p_company is null or q.company_id = p_company)
    and (current_date - q.sent_at::date) >= coalesce(s.cold_after_days,30)
    and not (q.aging_state = 'cold' and (current_date - q.sent_at::date) < coalesce(s.archive_after_days,60))
    and not exists (select 1 from public.quotes a where a.id <> q.id and a.status = 'accepted' and a.company_id is not distinct from q.company_id
            and ((q.option_group_id is not null and a.option_group_id = q.option_group_id)
              or (q.lead_id is not null and a.lead_id = q.lead_id and a.customer_id is not distinct from q.customer_id)))
$$;
revoke execute on function public.quote_aging_candidates(uuid) from anon, authenticated;

create or replace function public.quote_aging_sweep(p_force boolean default false)
returns int language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in select c.* from public.quote_aging_candidates(null) c
           join public.sales_automation_settings s on s.company_id = c.company_id
           where s.quote_aging_enabled and (p_force or s.last_aging_run is distinct from current_date) loop
    if r.action = 'archive' then
      insert into public.quote_aging_log(company_id, quote_id, action, prev_aging_state, prev_archived_at)
        select q.company_id, q.id, 'archived', q.aging_state, q.archived_at from public.quotes q where q.id = r.quote_id;
      update public.quotes set aging_state = 'cold', aging_at = coalesce(aging_at, now()), archived_at = now(),
        archive_reason = 'Auto: Cold, no reply 60 days' where id = r.quote_id;
    else
      insert into public.quote_aging_log(company_id, quote_id, action, prev_aging_state)
        select q.company_id, q.id, 'cold', q.aging_state from public.quotes q where q.id = r.quote_id;
      update public.quotes set aging_state = 'cold', aging_at = now() where id = r.quote_id;
    end if;
    n := n + 1;
  end loop;
  update public.sales_automation_settings set last_aging_run = current_date, updated_at = now() where quote_aging_enabled;
  return n;
end $$;
revoke execute on function public.quote_aging_sweep(boolean) from anon, authenticated;

-- Existing follow-up cron (every 10 min) now also runs the daily aging check. The check is a no-op while disabled.
create or replace function public.process_quote_followups()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record;
begin
  for r in select q.id, q.company_id, coalesce(q.customer_name,q.quote_number,'Quote') n, q.sales_engineer_id, q.followup_state, q.followup_count, q.followup_kind
    from public.quotes q where q.archived_at is null and q.followup_state in ('quoted','followed_up','viable','close_due')
      and q.status not in ('accepted','declined','superseded','void','option_not_chosen')
      and not exists (select 1 from public.quotes a where a.id <> q.id and a.status = 'accepted' and a.company_id is not distinct from q.company_id
            and ((q.option_group_id is not null and a.option_group_id = q.option_group_id)
              or (q.lead_id is not null and a.lead_id = q.lead_id and a.customer_id is not distinct from q.customer_id)))
      and (q.followup_state = 'close_due' or q.followup_next_at <= now()) loop
    if r.followup_state = 'close_due' then
      perform public._hb_nudge(r.company_id,'quote',r.id,'followup',9, array_remove(array[r.sales_engineer_id],null) || public._hb_admins(r.company_id), 'Close this quote?', r.n||': two follow-ups done, not locked in. Close it (can be reopened later).');
    else
      perform public._hb_nudge(r.company_id,'quote',r.id,'followup',r.followup_count+1, array_remove(array[r.sales_engineer_id],null) || public._hb_sales(r.company_id), 'Quote follow-up call',
        r.n||case when r.followup_kind='visit' then ': friendly follow-up '||(r.followup_count+1)||' of 2' when r.followup_state='viable' then ': call again (last call)' else ': follow-up call' end);
    end if;
  end loop;
  -- Daily quote aging (Cold 30 / archive 60). Only for companies that switched it on; at most once a day after 06:00 SAST.
  if (now() at time zone 'Africa/Johannesburg')::time >= '06:00' then
    perform public.quote_aging_sweep(false);
  end if;
end $function$;

-- Undo one auto change (admin): un-archive and/or clear Cold.
create or replace function public.quote_aging_undo(p_quote uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare q record;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.company_id is distinct from public.get_user_company_id(auth.uid()) then raise exception 'Not allowed'; end if;
  insert into public.quote_aging_log(company_id, quote_id, action, prev_aging_state, prev_archived_at) values (q.company_id, q.id, 'undo', q.aging_state, q.archived_at);
  update public.quotes set aging_state = null, aging_at = null,
    archived_at = case when archive_reason like 'Auto: Cold%' then null else archived_at end,
    archive_reason = case when archive_reason like 'Auto: Cold%' then null else archive_reason end
  where id = p_quote;
end $$;
grant execute on function public.quote_aging_undo(uuid) to authenticated;

-- Snooze (until a date) or dismiss, with a reason. New leads can never be snoozed.
create or replace function public.snooze_next_step(p_rule text, p_entity_type text, p_entity_id uuid, p_until timestamptz, p_dismiss boolean, p_reason text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_co uuid := public.get_user_company_id(auth.uid());
begin
  if auth.uid() is null or v_co is null then raise exception 'Not signed in'; end if;
  if p_rule = 'new_lead' then raise exception 'New leads cannot be snoozed'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason'; end if;
  if not p_dismiss and (p_until is null or p_until <= now()) then raise exception 'Pick a date in the future'; end if;
  update public.next_step_snoozes set cleared_at = now() where entity_id = p_entity_id and rule = p_rule and cleared_at is null and company_id = v_co;
  insert into public.next_step_snoozes(company_id, rule, entity_type, entity_id, snoozed_until, dismissed, reason)
    values (v_co, p_rule, p_entity_type, p_entity_id, case when p_dismiss then null else p_until end, p_dismiss, btrim(p_reason)) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.snooze_next_step(text,text,uuid,timestamptz,boolean,text) to authenticated;

-- The list. Reps: own clients only (forced). Others: all, optional p_rep filter. POPIA: unaccepted leads show job type + area only.
create or replace function public.sales_next_steps(p_rep uuid default null)
returns table(rule text, prio int, entity_type text, entity_id uuid, title text, detail text, amount numeric, since timestamptz, owner_id uuid, link text, snoozable boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_co uuid; v_rep uuid; v_is_rep boolean;
begin
  if v_uid is null then return; end if;
  v_co := public.get_user_company_id(v_uid);
  if v_co is null then return; end if;
  v_is_rep := public.is_sales_rep(v_uid);
  v_rep := case when v_is_rep then v_uid else p_rep end;

  return query
  with snz as (select s.entity_id, s.rule from public.next_step_snoozes s
               where s.company_id = v_co and s.cleared_at is null and (s.dismissed or s.snoozed_until > now())),
  q as (select x.*, coalesce(x.sales_engineer_id, x.owner_id, x.created_by) as own from public.quotes x
        where x.company_id = v_co and x.archived_at is null and coalesce(x.is_variation,false) = false),
  inv as (select i.*, ps.deposit_status, ps.final_outstanding, ps.has_deposit
          from public.invoices i cross join lateral public._inv_pay_schedule(i.id) ps
          where i.company_id = v_co and i.archived_at is null and lower(coalesce(i.status,'')) not in ('void','cancelled')
            and coalesce(i.deposit_type,'') <> 'deposit_invoice' and coalesce(i.notes,'') not like 'DEPOSIT%'),
  all_rows as (
    -- 1. New leads not yet contacted
    select 'new_lead'::text r, 1 p, 'lead'::text et, l.id eid,
      case when (not v_is_rep) or (l.assigned_agent_id = v_uid and l.accepted_at is not null) then coalesce(l.customer_name,'New lead')
           else coalesce(nullif(l.primary_intent::text,''), nullif(l.service_type::text,''), 'New lead') end t,
      concat_ws(' · ', coalesce(nullif(l.primary_intent::text,''), nullif(l.service_type::text,'')), nullif(l.call_area::text,''),
        case when l.assigned_agent_id is null then 'not accepted' else 'not contacted' end) d,
      null::numeric a, l.created_at s, l.assigned_agent_id o, '/admin/dispatch'::text lk
    from public.leads l
    where l.company_id = v_co and l.status = 'pending' and l.deleted_at is null and l.merged_into_id is null
      and l.dismissed_at is null and l.closed_at is null and l.first_contact_at is null
      and (v_rep is null or l.assigned_agent_id = v_rep
           or (v_is_rep and l.assigned_agent_id is null and exists (select 1 from public.offers f where f.lead_id = l.id and f.staff_id = v_uid and coalesce(f.status,'') in ('','pending','offered','sent'))))
    union all
    -- 2. Client seen, no quote sent
    select 'no_quote', 2, 'lead', l.id, coalesce(l.customer_name,'Client'), 'Site visit done, no quote sent', null,
      coalesce((select max(ss.completed_at) from public.site_surveys ss where ss.lead_id = l.id and ss.status='complete' and ss.archived_at is null), l.stage2_done_at),
      l.assigned_agent_id, '/admin/quote-builder?leadId='||l.id
    from public.leads l
    where l.company_id = v_co and l.deleted_at is null and l.merged_into_id is null and l.closed_at is null and l.dismissed_at is null
      and lower(coalesce(l.status,'')) not in ('cancelled','resolved_before_visit')
      and (l.stage2_done_at is not null or exists (select 1 from public.site_surveys ss where ss.lead_id = l.id and ss.status='complete' and ss.archived_at is null))
      and not exists (select 1 from public.quotes x where x.lead_id = l.id and (x.sent_at is not null or x.status in ('sent','viewed','accepted')))
      and (v_rep is null or l.assigned_agent_id = v_rep)
    union all
    -- 3. Quote sent 7+ days ago, no follow-up logged
    select 'followup', 3, 'quote', q.id, coalesce(q.customer_name, q.quote_number), concat_ws(' · ', q.quote_number, 'sent '||(current_date - q.sent_at::date)||' days ago, no follow-up'),
      q.total, q.sent_at, q.own, '/admin/quote-builder?quoteId='||q.id
    from q where q.status in ('sent','viewed') and q.sent_at <= now() - interval '7 days' and q.aging_state is null
      and coalesce(q.followup_count,0) = 0 and not exists (select 1 from public.quote_followups f where f.quote_id = q.id)
      and (v_rep is null or q.own = v_rep)
    union all
    -- 4. Cold quotes (auto at 30 days; archived at 60)
    select 'cold', 4, 'quote', q.id, coalesce(q.customer_name, q.quote_number), concat_ws(' · ', q.quote_number, 'Cold, archives in '||greatest(0, 60 - (current_date - q.sent_at::date))||' days'),
      q.total, q.aging_at, q.own, '/admin/quote-builder?quoteId='||q.id
    from q where q.aging_state = 'cold' and q.status in ('sent','viewed') and (v_rep is null or q.own = v_rep)
    union all
    -- 5. Accepted, invoice (deposit) not sent
    select 'deposit_invoice', 5, 'quote', q.id, coalesce(q.customer_name, q.quote_number), concat_ws(' · ', q.quote_number, 'accepted, invoice not sent'),
      q.total, q.accepted_at, q.own,
      coalesce((select '/admin/invoices/'||i.id from public.invoices i where i.quote_id = q.id and lower(coalesce(i.status,'')) not in ('void','cancelled') limit 1), '/admin/invoices/new?quoteId='||q.id)
    from q where q.status = 'accepted'
      and not exists (select 1 from public.invoices i where i.quote_id = q.id and i.sent_at is not null and lower(coalesce(i.status,'')) not in ('void','cancelled'))
      and (v_rep is null or q.own = v_rep)
    union all
    -- 6. Deposit paid in full, no installation date
    select 'book_install', 6, 'invoice', i.id, coalesce(i.customer_name, i.invoice_number), concat_ws(' · ', i.invoice_number, 'deposit paid, no installation date'),
      i.deposit_amount, i.updated_at, coalesce(qq.own, i.agent_id), '/admin/invoices/'||i.id
    from inv i left join q qq on qq.id = i.quote_id
    where i.has_deposit and i.deposit_status = 'paid'
      and not exists (select 1 from public.jobs j where ((i.quote_id is not null and j.quote_id = i.quote_id) or j.invoice_id = i.id)
                      and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void') and (j.scheduled_for is not null or j.completed_at is not null))
      and (v_rep is null or coalesce(qq.own, i.agent_id) = v_rep)
    union all
    -- 7. Installation booked, no technician
    select 'assign_tech', 7, 'job', j.id, coalesce(j.title,'Job'), 'Booked '||to_char(j.scheduled_for at time zone 'Africa/Johannesburg','DD Mon')||', no technician',
      null, j.scheduled_for, coalesce(qq.own, j.created_by), '/admin/jobs/'||j.id
    from public.jobs j left join q qq on qq.id = j.quote_id
    where j.company_id = v_co and j.scheduled_for is not null and j.completed_at is null
      and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void','completed')
      and not exists (select 1 from public.assignments a where a.job_id = j.id and coalesce(a.status,'') <> 'cancelled')
      and (v_rep is null or coalesce(qq.own, j.created_by) = v_rep)
    union all
    -- 8. Job done: final invoice not sent, or unpaid 2+ days after completion
    select case when i.final_sent_at is null then 'final_invoice' else 'final_unpaid' end, 8, 'invoice', i.id, coalesce(i.customer_name, i.invoice_number),
      concat_ws(' · ', i.invoice_number, case when i.final_sent_at is null then 'job done, final invoice not sent' else 'final unpaid '||(current_date - public._inv_job_done(i.id))||' days after completion' end),
      i.final_outstanding, public._inv_job_done(i.id)::timestamptz, coalesce(qq.own, i.agent_id), '/admin/invoices/'||i.id
    from inv i left join q qq on qq.id = i.quote_id
    where i.has_deposit and public._inv_job_done(i.id) is not null and coalesce(i.final_outstanding,0) > 0.005
      and (i.final_sent_at is null or public._inv_job_done(i.id) <= current_date - 2)
      and (v_rep is null or coalesce(qq.own, i.agent_id) = v_rep)
  )
  select ar.r, ar.p, ar.et, ar.eid, ar.t, ar.d, ar.a, ar.s, ar.o, ar.lk, ar.r <> 'new_lead'
  from all_rows ar where not exists (select 1 from snz where snz.entity_id = ar.eid and snz.rule = ar.r)
  order by ar.p, ar.s nulls last;
end $$;
revoke execute on function public.sales_next_steps(uuid) from anon;
grant execute on function public.sales_next_steps(uuid) to authenticated;
