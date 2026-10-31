-- Next steps: follow-up cards show from the send day (coloured by age in the app); Cold 'since' = 30 days after send.
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
    -- 3. Quote sent, no follow-up logged (green < 5 days, orange 5-7, red 7+; colour set in the app)
    select 'followup', 3, 'quote', q.id, coalesce(q.customer_name, q.quote_number), concat_ws(' · ', q.quote_number, 'sent '||(current_date - q.sent_at::date)||' days ago, no follow-up'),
      q.total, q.sent_at, q.own, '/admin/quote-builder?quoteId='||q.id
    from q where q.status in ('sent','viewed') and q.sent_at is not null and q.aging_state is null
      and coalesce(q.followup_count,0) = 0 and not exists (select 1 from public.quote_followups f where f.quote_id = q.id)
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
end $$;
revoke execute on function public.sales_next_steps(uuid) from anon;
grant execute on function public.sales_next_steps(uuid) to authenticated;
