-- Rollback for 0027 (quote delete / archive). Restores the three cron functions exactly as they were live on 23 Oct 2026,
-- drops the RPCs and helpers, then the columns. NOTE: dropping the columns un-archives every archived quote
-- (the archive reason stays in audit_log, action 'archive'). Deleted quotes are NOT restored by this file: their full
-- snapshot is in audit_log.old_data (action 'delete', via quote_delete).
CREATE OR REPLACE FUNCTION public.process_quote_followups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.quotes_followup_due_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.quotes q
  where q.followup_state is not null and q.followup_state <> 'closed' and q.followup_next_at is not null
    and q.followup_next_at < (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '2 day') at time zone 'Africa/Johannesburg' $function$;

CREATE OR REPLACE FUNCTION public.process_sales_escalations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_now timestamptz := now(); v_local timestamp := (now() at time zone 'Africa/Johannesburg');
  v_open boolean := extract(isodow from v_local) between 1 and 5 and v_local::time between '08:00' and '17:00';
  m numeric;
begin
  -- New lead, not contacted, not acknowledged (business hours only): 5 min rep, 15 min all sales + admin, 30 min owner/admin
  if v_open then
  for r in select l.id, l.company_id, l.customer_name, l.assigned_agent_id, extract(epoch from v_now - l.created_at)/60 as mins
    from public.leads l where l.status = 'pending' and l.first_contact_at is null and l.acknowledged_at is null
      and l.deleted_at is null and l.dismissed_at is null and l.closed_at is null and l.merged_into_id is null and l.primary_intent is distinct from 'service'
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
      and l.deleted_at is null and l.dismissed_at is null and l.closed_at is null and l.merged_into_id is null and l.primary_intent is distinct from 'service'
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
  perform public.process_invoice_followups();
end $function$;

DROP FUNCTION IF EXISTS public.quote_unarchive(uuid);
DROP FUNCTION IF EXISTS public.quote_archive(uuid, text);
DROP FUNCTION IF EXISTS public.quote_delete(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.quote_delete_check(uuid);
DROP FUNCTION IF EXISTS public._quote_snapshot(uuid);
DROP FUNCTION IF EXISTS public._quote_delete_facts(uuid, uuid);
DROP FUNCTION IF EXISTS public._quote_admin_row(uuid);
DROP INDEX IF EXISTS public.idx_quotes_company_not_archived;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS archived_by;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS archived_at;
