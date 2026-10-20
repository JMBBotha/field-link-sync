-- Lead Dismiss (main company only) + Close (any company) with audit. Johan 20 Oct 11:43/11:44.
alter table public.leads
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid,
  add column if not exists dismiss_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid,
  add column if not exists close_outcome text check (close_outcome in ('lost','not_real_job')),
  add column if not exists close_reason text,
  add column if not exists close_note text,
  add column if not exists pre_close_status text,
  add column if not exists pre_close_lead_status public.lead_lifecycle_status;
create index if not exists leads_dismissed_idx on public.leads(company_id, dismissed_at) where dismissed_at is not null;

-- LOST only allowed when someone actually visited AND a proper (non-remote) quote was sent.
create or replace function public.lead_lost_allowed(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    (exists (select 1 from public.site_surveys s where s.lead_id = p_lead and s.completed_at is not null and s.archived_at is null)
    or exists (select 1 from public.leads l where l.id = p_lead and l.visit_booked_at is not null and l.scheduled_date is not null and l.scheduled_date::date <= current_date))
  and exists (select 1 from public.quotes q where q.lead_id = p_lead and q.sent_at is not null and coalesce(q.remote_quote,false) = false
              and coalesce(q.status,'') not in ('draft','superseded','void'))
$$;
grant execute on function public.lead_lost_allowed(uuid) to authenticated;

create or replace function public._lead_staff_ok() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'dispatcher') $$;

create or replace function public.dismiss_lead(p_lead uuid, p_reason text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz := now(); l record;
begin
  if not public._lead_staff_ok() then raise exception 'Not allowed'; end if;
  if public.caller_company_id() is distinct from public.fl_master_company_id() then raise exception 'Only the main company can dismiss leads. Use Close lead.'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'A reason is required'; end if;
  select * into l from public.leads where id = p_lead and company_id = public.fl_master_company_id() for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.dismissed_at is not null or l.closed_at is not null then raise exception 'Lead already dismissed/closed'; end if;
  update public.leads set dismissed_at = v, dismissed_by = auth.uid(), dismiss_reason = trim(p_reason),
    pre_close_status = status, pre_close_lead_status = lead_status,
    status = 'resolved_before_visit', lead_status = 'resolved_before_visit'
   where id = p_lead;
  return v;
end $$;

create or replace function public.close_lead(p_lead uuid, p_outcome text, p_reason text, p_note text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz := now(); l record; v_master boolean;
begin
  if not public._lead_staff_ok() then raise exception 'Not allowed'; end if;
  if p_outcome not in ('lost','not_real_job') then raise exception 'Invalid outcome'; end if;
  if length(trim(coalesce(p_reason,''))) < 2 then raise exception 'A reason is required'; end if;
  v_master := public.caller_company_id() = public.fl_master_company_id() and public.has_role(auth.uid(),'admin');
  select * into l from public.leads where id = p_lead and (company_id = public.caller_company_id() or v_master) for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.dismissed_at is not null or l.closed_at is not null then raise exception 'Lead already dismissed/closed'; end if;
  if p_outcome = 'lost' and not public.lead_lost_allowed(p_lead) then
    raise exception 'Lost needs a completed site visit and a quote sent from it. Use Not a real job.'; end if;
  update public.leads set closed_at = v, closed_by = auth.uid(), close_outcome = p_outcome, close_reason = trim(p_reason),
    close_note = nullif(trim(coalesce(p_note,'')),''), pre_close_status = status, pre_close_lead_status = lead_status,
    status = case when p_outcome = 'lost' then 'cancelled' else 'resolved_before_visit' end,
    lead_status = case when p_outcome = 'lost' then 'lost'::lead_lifecycle_status else 'resolved_before_visit'::lead_lifecycle_status end,
    cancellation_reason = case when p_outcome = 'lost' then trim(p_reason) else cancellation_reason end
   where id = p_lead;
  return v;
end $$;

-- Restore (admin only). Audit is kept in interaction_history.
create or replace function public.restore_lead(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Only admins can restore'; end if;
  select * into l from public.leads where id = p_lead and (company_id = public.caller_company_id() or public.caller_company_id() = public.fl_master_company_id()) for update;
  if not found or (l.dismissed_at is null and l.closed_at is null) then raise exception 'Lead not found or not closed'; end if;
  update public.leads set
    interaction_history = coalesce(interaction_history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('type','restored','at',now(),'by',auth.uid(),
      'dismissed_at',dismissed_at,'dismissed_by',dismissed_by,'dismiss_reason',dismiss_reason,'closed_at',closed_at,'closed_by',closed_by,'close_outcome',close_outcome,'close_reason',close_reason,'close_note',close_note)),
    status = coalesce(pre_close_status,'pending'), lead_status = coalesce(pre_close_lead_status,'new'),
    dismissed_at = null, dismissed_by = null, dismiss_reason = null, closed_at = null, closed_by = null,
    close_outcome = null, close_reason = null, close_note = null, pre_close_status = null, pre_close_lead_status = null
   where id = p_lead;
end $$;
grant execute on function public.dismiss_lead(uuid,text), public.close_lead(uuid,text,text,text), public.restore_lead(uuid) to authenticated;
revoke execute on function public._lead_staff_ok() from anon;

-- Heartbeat escalations / nags skip dismissed and closed leads.
do $$ declare d text; begin
  d := pg_get_functiondef('public.process_sales_escalations()'::regprocedure);
  if position('l.dismissed_at is null' in d) = 0 then
    d := replace(d, 'l.deleted_at is null', 'l.deleted_at is null and l.dismissed_at is null and l.closed_at is null');
    execute d;
  end if;
end $$;

-- 11:46 refinement: non-visit closes stay marketable contacts.
alter table public.leads add column if not exists marketing_followup boolean not null default false;
create index if not exists leads_marketing_followup_idx on public.leads(company_id) where marketing_followup;
create or replace function public._lead_mark_followup() returns trigger language plpgsql set search_path = public as $$
begin
  if new.close_outcome = 'not_real_job' and old.close_outcome is distinct from 'not_real_job' then new.marketing_followup := true; end if;
  return new;
end $$;
drop trigger if exists leads_mark_followup on public.leads;
create trigger leads_mark_followup before update of close_outcome on public.leads for each row execute function public._lead_mark_followup();
