-- Quote option groups from Next steps (Johan 1 Nov 2026).
-- Reuses quotes.option_group_id (existing). Accepting one option already sets the others to
-- 'option_not_chosen' (trigger fl_quote_stage_log), which drops them from Next steps.

create or replace function public._quote_group_can(p_uid uuid, q public.quotes)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fl_can_manage_quotes(p_uid, q.company_id)
      or coalesce(q.sales_engineer_id, q.owner_id, q.created_by) = p_uid
$$;
revoke all on function public._quote_group_can(uuid, public.quotes) from public, anon;

create or replace function public.group_quote_option(p_quote uuid, p_other uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_co uuid; a public.quotes; b public.quotes; v_gid uuid; v_win record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_co := public.get_user_company_id(v_uid);
  if p_quote = p_other then raise exception 'Pick a different quote'; end if;
  select * into a from public.quotes where id = p_quote and company_id = v_co;
  select * into b from public.quotes where id = p_other and company_id = v_co;
  if a.id is null or b.id is null then raise exception 'Quote not found'; end if;
  if not (public._quote_group_can(v_uid, a) and public._quote_group_can(v_uid, b)) then
    raise exception 'You can only group your own quotes' using errcode = '42501'; end if;
  if not ((a.customer_id is not null and a.customer_id = b.customer_id)
          or (a.customer_id is null and b.customer_id is null and a.lead_id is not null and a.lead_id = b.lead_id)) then
    raise exception 'Both quotes must be for the same client'; end if;
  if a.status not in ('draft','sent','viewed') then raise exception 'This quote is no longer open'; end if;
  if b.status not in ('draft','sent','viewed','accepted') then raise exception 'That quote is no longer open'; end if;
  v_gid := coalesce(b.option_group_id, a.option_group_id, gen_random_uuid());
  -- merge any old group of a into the target group
  update public.quotes set option_group_id = v_gid
   where company_id = v_co and (id in (a.id, b.id) or (a.option_group_id is not null and option_group_id = a.option_group_id));
  if (select count(*) from public.quotes where option_group_id = v_gid and status = 'accepted') > 1 then
    raise exception 'More than one of these quotes is accepted'; end if;
  select id, quote_number into v_win from public.quotes where option_group_id = v_gid and status = 'accepted' limit 1;
  if v_win.id is not null then
    perform set_config('app.quote_stage_kind', 'option_link', true);
    perform set_config('app.quote_stage_reason', 'Grouped as options; client chose ' || coalesce(v_win.quote_number,''), true);
    update public.quotes set status = 'option_not_chosen', option_chosen_id = v_win.id,
      followup_state = case when followup_state is null then null else 'closed' end, followup_next_at = null
     where option_group_id = v_gid and id <> v_win.id and status in ('draft','sent','viewed');
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  values ('quotes', a.id, 'update', jsonb_build_object('option_group_id', a.option_group_id),
          jsonb_build_object('event','group_quote_option','option_group_id', v_gid, 'with_quote', b.id, 'with_number', b.quote_number), v_uid, v_co);
  return v_gid;
end $$;

create or replace function public.ungroup_quote_option(p_quote uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_co uuid; q public.quotes; v_left uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_co := public.get_user_company_id(v_uid);
  select * into q from public.quotes where id = p_quote and company_id = v_co;
  if q.id is null then raise exception 'Quote not found'; end if;
  if not public._quote_group_can(v_uid, q) then raise exception 'You can only ungroup your own quotes' using errcode = '42501'; end if;
  if q.option_group_id is null then return false; end if;
  if q.status = 'option_not_chosen' then raise exception 'Reopen it first (Move back), then ungroup'; end if;
  update public.quotes set option_group_id = null, option_label = null, option_chosen_id = null where id = q.id;
  -- a group of one is no group
  if (select count(*) from public.quotes where option_group_id = q.option_group_id) = 1 then
    select id into v_left from public.quotes where option_group_id = q.option_group_id and status <> 'option_not_chosen';
    if v_left is not null then update public.quotes set option_group_id = null, option_label = null where id = v_left; end if;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  values ('quotes', q.id, 'update', jsonb_build_object('option_group_id', q.option_group_id),
          jsonb_build_object('event','ungroup_quote_option','option_group_id', null), v_uid, v_co);
  return true;
end $$;

revoke all on function public.group_quote_option(uuid, uuid) from public, anon;
revoke all on function public.ungroup_quote_option(uuid) from public, anon;
grant execute on function public.group_quote_option(uuid, uuid) to authenticated;
grant execute on function public.ungroup_quote_option(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.sales_next_steps(p_rep uuid DEFAULT NULL::uuid)
 RETURNS TABLE(rule text, prio integer, entity_type text, entity_id uuid, title text, detail text, amount numeric, since timestamp with time zone, owner_id uuid, link text, snoozable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_co uuid; v_rep uuid; v_is_rep boolean;
begin
  if v_uid is null then return; end if;
  v_co := public.get_user_company_id(v_uid);
  if v_co is null then return; end if;
  v_is_rep := public.sales_scope_own(v_uid);
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
    -- 3. Quote sent, no follow-up logged (green < 5 days, orange 5-7, red 7+; colour set in the app)
    select 'followup', 3, 'quote', q.id, coalesce(q.customer_name, q.quote_number), concat_ws(' · ', q.quote_number, 'sent '||(current_date - q.sent_at::date)||' days ago, no follow-up'),
      q.total, q.sent_at, q.own, '/admin/quote-builder?quoteId='||q.id
    from q where q.status in ('sent','viewed') and q.sent_at is not null and q.aging_state is null
      and coalesce(q.followup_count,0) = 0 and not exists (select 1 from public.quote_followups f where f.quote_id = q.id)
      -- Options of one project: a follow-up on any option covers the whole group (Johan 1 Nov 2026).
      and (q.option_group_id is null or not exists (select 1 from public.quotes s where s.option_group_id = q.option_group_id and s.company_id = v_co
             and (coalesce(s.followup_count,0) > 0 or exists (select 1 from public.quote_followups f where f.quote_id = s.id))))
      and (v_rep is null or q.own = v_rep)
    union all
    -- 4. Cold quotes (auto at 30 days; archived at 60)
    select 'cold', 4, 'quote', q.id, coalesce(q.customer_name, q.quote_number), concat_ws(' · ', q.quote_number, 'Cold, archives in '||greatest(0, 60 - (current_date - q.sent_at::date))||' days'),
      q.total, q.sent_at + interval '30 days', q.own, '/admin/quote-builder?quoteId='||q.id
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
end $function$
;
