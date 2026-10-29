-- Johan 29 Oct 14:43: when a client accepts a quote, follow-ups stop for that quote and its sibling options.
-- Siblings are NOT marked lost/declined; only their follow-up closes. No client messages.

-- 1. Closed statuses now include option_not_chosen.
create or replace function public._quote_followup_on_send() returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if new.sent_at is not null and (old.sent_at is null) and new.followup_state is null then
    k := case when public._quote_is_visit(new.id) then 'visit' else 'remote' end;
    new.followup_kind := k; new.followup_state := 'quoted'; new.followup_count := 0;
    new.followup_next_at := new.sent_at + make_interval(days => public._hb_limit(new.company_id, case when k='visit' then 'visitFollowup1Days' else 'remoteFollowupDays' end, case when k='visit' then 3 else 2 end)::int);
  end if;
  if new.status in ('accepted','declined','superseded','void','option_not_chosen') and new.followup_state is distinct from 'closed' and new.followup_state is not null then
    new.followup_state := 'closed'; new.followup_next_at := null;
  end if;
  return new;
end $$;

-- 2. After accept / close: close sibling follow-ups (same option group, or same lead + same client) and clear unread follow-up nudges.
create or replace function public._quote_followup_cleanup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    update public.quotes s set followup_state = 'closed', followup_next_at = null
     where s.id <> new.id and s.company_id is not distinct from new.company_id
       and s.followup_state is not null and s.followup_state <> 'closed'
       and ((new.option_group_id is not null and s.option_group_id = new.option_group_id)
         or (new.lead_id is not null and s.lead_id = new.lead_id and s.customer_id is not distinct from new.customer_id));
  end if;
  if new.followup_state = 'closed' and old.followup_state is distinct from 'closed' then
    update public.notifications set read = true
     where type = 'sales_nudge' and related_id = new.id and metadata->>'stage' = 'followup' and read = false;
  end if;
  return null;
end $$;
drop trigger if exists quotes_followup_cleanup on public.quotes;
create trigger quotes_followup_cleanup after update of status, followup_state on public.quotes
  for each row execute function public._quote_followup_cleanup();

-- 3. Cron never nudges option_not_chosen quotes, or quotes whose sibling was accepted.
create or replace function public.process_quote_followups() returns void language plpgsql security definer set search_path = public as $$
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
end $$;
