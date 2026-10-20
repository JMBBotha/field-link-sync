-- Quote follow-up flow (Johan 20 Oct 11:49) + sales reps may Dismiss/Close own/unassigned leads (11:51).
alter table public.quotes
  add column if not exists followup_kind text check (followup_kind in ('remote','visit')),
  add column if not exists followup_state text check (followup_state in ('quoted','followed_up','viable','close_due','closed')),
  add column if not exists followup_count int not null default 0,
  add column if not exists followup_next_at timestamptz;
create table if not exists public.quote_followups (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  company_id uuid,
  seq int not null,
  result text not null check (result in ('viable','done','closed')),
  next_at timestamptz,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists quote_followups_quote_idx on public.quote_followups(quote_id, created_at);
alter table public.quote_followups enable row level security;
drop policy if exists "quote_followups company read" on public.quote_followups;
create policy "quote_followups company read" on public.quote_followups for select to authenticated
  using (company_id = public.caller_company_id() or public.caller_company_id() = public.fl_master_company_id());

-- Visit quote = a completed visit exists for the lead and the quote is not remote.
create or replace function public._quote_is_visit(p_quote uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(q.remote_quote,false) = false and q.lead_id is not null and (
    exists (select 1 from public.site_surveys s where s.lead_id = q.lead_id and s.completed_at is not null and s.archived_at is null)
    or exists (select 1 from public.leads l where l.id = q.lead_id and l.visit_booked_at is not null and l.scheduled_date is not null and l.scheduled_date::date <= current_date))
  from public.quotes q where q.id = p_quote $$;

-- Schedule the first follow-up when a quote is sent.
create or replace function public._quote_followup_on_send() returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if new.sent_at is not null and (old.sent_at is null) and new.followup_state is null then
    k := case when public._quote_is_visit(new.id) then 'visit' else 'remote' end;
    new.followup_kind := k; new.followup_state := 'quoted'; new.followup_count := 0;
    new.followup_next_at := new.sent_at + make_interval(days => public._hb_limit(new.company_id, case when k='visit' then 'visitFollowup1Days' else 'remoteFollowupDays' end, case when k='visit' then 3 else 2 end)::int);
  end if;
  if new.status in ('accepted','declined','superseded','void') and new.followup_state is distinct from 'closed' and new.followup_state is not null then
    new.followup_state := 'closed'; new.followup_next_at := null;
  end if;
  return new;
end $$;
drop trigger if exists quotes_followup_on_send on public.quotes;
create trigger quotes_followup_on_send before update of sent_at, status on public.quotes for each row execute function public._quote_followup_on_send();

-- Who may close/dismiss: admin (company / main admin), or a sales rep for own or unassigned leads.
create or replace function public.can_close_lead(p_lead uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leads l where l.id = p_lead and (
    (public.has_role(auth.uid(),'admin') and (l.company_id = public.caller_company_id() or public.caller_company_id() = public.fl_master_company_id()))
    or (public.has_role(auth.uid(),'dispatcher') and l.company_id = public.caller_company_id()
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.dispatch_role in ('sales','sales_engineer'))
        and (l.assigned_agent_id is null or l.assigned_agent_id = auth.uid()))))
$$;
grant execute on function public.can_close_lead(uuid) to authenticated;

create or replace function public.dismiss_lead(p_lead uuid, p_reason text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz := now(); l record;
begin
  if public.caller_company_id() is distinct from public.fl_master_company_id() then raise exception 'Only the main company can dismiss leads. Use Close lead.'; end if;
  if not public.can_close_lead(p_lead) then raise exception 'Not allowed'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'A reason is required'; end if;
  select * into l from public.leads where id = p_lead and company_id = public.fl_master_company_id() for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.dismissed_at is not null or l.closed_at is not null then raise exception 'Lead already dismissed/closed'; end if;
  update public.leads set dismissed_at = v, dismissed_by = auth.uid(), dismiss_reason = trim(p_reason),
    pre_close_status = status, pre_close_lead_status = lead_status, status = 'resolved_before_visit', lead_status = 'resolved_before_visit'
   where id = p_lead;
  update public.quotes set followup_state = 'closed', followup_next_at = null where lead_id = p_lead and followup_state is distinct from 'closed' and followup_state is not null;
  return v;
end $$;

create or replace function public.close_lead(p_lead uuid, p_outcome text, p_reason text, p_note text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz := now(); l record;
begin
  if p_outcome not in ('lost','not_real_job') then raise exception 'Invalid outcome'; end if;
  if not public.can_close_lead(p_lead) then raise exception 'Not allowed'; end if;
  if length(trim(coalesce(p_reason,''))) < 2 then raise exception 'A reason is required'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.dismissed_at is not null or l.closed_at is not null then raise exception 'Lead already dismissed/closed'; end if;
  if p_outcome = 'lost' and not public.lead_lost_allowed(p_lead) then
    raise exception 'Lost needs a completed site visit and a quote sent from it. Use Estimate only.'; end if;
  update public.leads set closed_at = v, closed_by = auth.uid(), close_outcome = p_outcome, close_reason = trim(p_reason),
    close_note = nullif(trim(coalesce(p_note,'')),''), pre_close_status = status, pre_close_lead_status = lead_status,
    status = case when p_outcome = 'lost' then 'cancelled' else 'resolved_before_visit' end,
    lead_status = case when p_outcome = 'lost' then 'lost'::lead_lifecycle_status else 'resolved_before_visit'::lead_lifecycle_status end,
    cancellation_reason = case when p_outcome = 'lost' then trim(p_reason) else cancellation_reason end
   where id = p_lead;
  update public.quotes set followup_state = 'closed', followup_next_at = null where lead_id = p_lead and followup_state is distinct from 'closed' and followup_state is not null;
  return v;
end $$;

create or replace function public.restore_lead(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if not public.can_close_lead(p_lead) then raise exception 'Not allowed'; end if;
  select * into l from public.leads where id = p_lead for update;
  if l.dismissed_at is null and l.closed_at is null then raise exception 'Lead is not closed'; end if;
  update public.leads set
    interaction_history = coalesce(interaction_history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('type','reopened','at',now(),'by',auth.uid(),
      'dismissed_at',dismissed_at,'dismissed_by',dismissed_by,'dismiss_reason',dismiss_reason,'closed_at',closed_at,'closed_by',closed_by,'close_outcome',close_outcome,'close_reason',close_reason,'close_note',close_note)),
    status = coalesce(pre_close_status,'pending'), lead_status = coalesce(pre_close_lead_status,'new'),
    dismissed_at = null, dismissed_by = null, dismiss_reason = null, closed_at = null, closed_by = null,
    close_outcome = null, close_reason = null, close_note = null, pre_close_status = null, pre_close_lead_status = null
   where id = p_lead;
end $$;

-- Log a follow-up call. remote: call 1 -> viable(date) or close; viable call -> must close.
-- visit: call 1 & 2 'done' (friendly), after call 2 -> close_due (prompt to close).
create or replace function public.log_quote_followup(p_quote uuid, p_result text, p_next timestamptz default null, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare q record; n int; st text; nxt timestamptz;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found or q.followup_state is null or q.followup_state = 'closed' then raise exception 'No open follow-up on this quote'; end if;
  if not ((public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'dispatcher')) and (q.company_id = public.caller_company_id() or public.caller_company_id() = public.fl_master_company_id())) then raise exception 'Not allowed'; end if;
  if p_result not in ('viable','done','closed') then raise exception 'Invalid result'; end if;
  n := q.followup_count + 1;
  if p_result = 'closed' then st := 'closed'; nxt := null;
  elsif q.followup_kind = 'remote' then
    if p_result <> 'viable' then raise exception 'Pick Still viable (with a date) or Close'; end if;
    if q.followup_state = 'viable' then raise exception 'Already called again once. Close it now (it can be reopened later).'; end if;
    if p_next is null or p_next <= now() then raise exception 'Pick the next call date'; end if;
    st := 'viable'; nxt := p_next;
  else
    if n >= 2 then st := 'close_due'; nxt := null;
    else st := 'followed_up'; nxt := now() + make_interval(days => public._hb_limit(q.company_id,'visitFollowup2Days',7)::int); end if;
  end if;
  insert into public.quote_followups(quote_id, company_id, seq, result, next_at, note) values (p_quote, q.company_id, n, p_result, nxt, nullif(trim(coalesce(p_note,'')),''));
  update public.quotes set followup_count = n, followup_state = st, followup_next_at = nxt where id = p_quote;
  return st;
end $$;
grant execute on function public.log_quote_followup(uuid,text,timestamptz,text) to authenticated;

-- Nudges (feeds heartbeat via sales_escalations, stage 'followup'). Level = call number; 9 = close prompt.
create or replace function public.process_quote_followups() returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select q.id, q.company_id, coalesce(q.customer_name,q.quote_number,'Quote') n, q.sales_engineer_id, q.followup_state, q.followup_count, q.followup_kind
    from public.quotes q where q.followup_state in ('quoted','followed_up','viable','close_due') and q.status not in ('accepted','declined','superseded','void')
      and (q.followup_state = 'close_due' or q.followup_next_at <= now()) loop
    if r.followup_state = 'close_due' then
      perform public._hb_nudge(r.company_id,'quote',r.id,'followup',9, array_remove(array[r.sales_engineer_id],null) || public._hb_admins(r.company_id), 'Close this quote?', r.n||': two follow-ups done, not locked in. Close it (can be reopened later).');
    else
      perform public._hb_nudge(r.company_id,'quote',r.id,'followup',r.followup_count+1, array_remove(array[r.sales_engineer_id],null) || public._hb_sales(r.company_id), 'Quote follow-up call',
        r.n||case when r.followup_kind='visit' then ': friendly follow-up '||(r.followup_count+1)||' of 2' when r.followup_state='viable' then ': call again (last call)' else ': follow-up call' end);
    end if;
  end loop;
end $$;

-- Backfill open sent quotes (no nudge storm: start from now).
update public.quotes q set followup_kind = case when public._quote_is_visit(q.id) then 'visit' else 'remote' end, followup_state = 'quoted', followup_count = 0,
  followup_next_at = now() + interval '1 day'
 where q.sent_at is not null and q.status in ('sent','viewed') and q.followup_state is null;

select cron.unschedule('quote-followups') where exists (select 1 from cron.job where jobname = 'quote-followups');
select cron.schedule('quote-followups', '*/10 * * * *', 'select public.process_quote_followups()');
