-- Accepted quote with no job: a next step and one in-app reminder after 24 weekday hours.
-- No email. Imported IND- quotes and variations are excluded. A job on a sister option counts as booked.
-- The next-step list is the durable prompt. The tick only raises the notification once.


-- Hours that fall on Monday-Friday in Johannesburg, including evenings.
-- 24 of these is the wait before "accepted, no job booked". Weekends do not count.
CREATE OR REPLACE FUNCTION public.fl_weekday_hours(p_from timestamptz, p_to timestamptz)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(SUM(EXTRACT(epoch FROM (
    LEAST(p_to, ((day + interval '1 day') AT TIME ZONE 'Africa/Johannesburg'))
    - GREATEST(p_from, (day AT TIME ZONE 'Africa/Johannesburg'))
  )) / 3600.0), 0)
  FROM generate_series(
    (p_from AT TIME ZONE 'Africa/Johannesburg')::date,
    (p_to AT TIME ZONE 'Africa/Johannesburg')::date,
    interval '1 day'
  ) AS gs(day)
  WHERE p_to > p_from AND EXTRACT(isodow FROM day) < 6;
$$;

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
    -- 5b. Accepted long enough, still no job. 24 weekday hours. In-app only.
    select 'accepted_unbooked', 5, 'quote', q.id, coalesce(q.customer_name, q.quote_number),
      concat_ws(' · ', q.quote_number, 'accepted, no job booked'),
      q.total, q.accepted_at, q.own, '/admin/quote-builder?quoteId='||q.id
    from q
    where q.status = 'accepted' and q.accepted_at is not null
      and coalesce(q.quote_number, '') !~ '^IND-'
      and public.fl_weekday_hours(q.accepted_at, now()) >= 24
      and not exists (
        select 1 from public.jobs j
        where j.quote_id = q.id
          and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void'))
      and (q.option_group_id is null or not exists (
        select 1 from public.quotes s
        join public.jobs j on j.quote_id = s.id
        where s.option_group_id = q.option_group_id and s.company_id = v_co
          and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void')))
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
end $function$;


CREATE TABLE IF NOT EXISTS public.accepted_unbooked_reminders (
  quote_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.accepted_unbooked_reminders ENABLE ROW LEVEL SECURITY;

-- In-app only. No email. One reminder per quote, after 24 weekday hours with no job.
CREATE OR REPLACE FUNCTION public.fl_accepted_unbooked_tick(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_uid uuid;
  n int := 0;
  v_body text;
BEGIN
  FOR r IN
    SELECT q.id, q.company_id, q.quote_number, q.customer_name,
           coalesce(q.sales_engineer_id, q.owner_id, q.created_by) AS own
      FROM public.quotes q
     WHERE q.status = 'accepted'
       AND q.archived_at IS NULL
       AND coalesce(q.is_variation, false) = false
       AND q.accepted_at IS NOT NULL
       AND coalesce(q.quote_number, '') !~ '^IND-'
       AND public.fl_weekday_hours(q.accepted_at, p_now) >= 24
       AND NOT EXISTS (
         SELECT 1 FROM public.jobs j
          WHERE j.quote_id = q.id
            AND lower(coalesce(j.status, '')) NOT IN ('cancelled', 'canceled', 'void'))
       AND (q.option_group_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.quotes s
         JOIN public.jobs j ON j.quote_id = s.id
         WHERE s.option_group_id = q.option_group_id
           AND lower(coalesce(j.status, '')) NOT IN ('cancelled', 'canceled', 'void')))
       AND NOT EXISTS (SELECT 1 FROM public.accepted_unbooked_reminders m WHERE m.quote_id = q.id)
  LOOP
    INSERT INTO public.accepted_unbooked_reminders (quote_id, company_id)
    VALUES (r.id, r.company_id);
    v_body := coalesce(r.customer_name, r.quote_number, 'A quote') || ' was accepted and still has no job booked.';
    IF r.own IS NOT NULL THEN
      PERFORM public.fl_alert_deliver(
        r.own, 'accepted_no_job', 'Accepted, no job booked', v_body, r.id,
        jsonb_build_object('quote_id', r.id, 'href', '/admin/quote-builder?quoteId=' || r.id));
    END IF;
    IF to_regprocedure('public.fl_company_admin_ids(uuid)') IS NOT NULL THEN
      FOR v_uid IN SELECT public.fl_company_admin_ids(r.company_id) LOOP
        IF v_uid IS DISTINCT FROM r.own THEN
          PERFORM public.fl_alert_deliver(
            v_uid, 'accepted_no_job', 'Accepted, no job booked', v_body, r.id,
            jsonb_build_object('quote_id', r.id, 'href', '/admin/quote-builder?quoteId=' || r.id));
        END IF;
      END LOOP;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.fl_accepted_unbooked_tick(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fl_accepted_unbooked_tick(timestamptz) TO service_role;

COMMENT ON FUNCTION public.fl_accepted_unbooked_tick(timestamptz) IS
  'In-app reminder only. No client email. One notification after 24 weekday hours when an accepted quote still has no job.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'accepted-unbooked-reminder') THEN
      PERFORM cron.unschedule('accepted-unbooked-reminder');
    END IF;
    PERFORM cron.schedule(
      'accepted-unbooked-reminder',
      '15 * * * 1-5',
      'SELECT public.fl_accepted_unbooked_tick()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'accepted-unbooked cron not scheduled: %', SQLERRM;
END $$;
