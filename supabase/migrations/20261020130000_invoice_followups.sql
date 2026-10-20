-- Invoice due follow-ups (Johan approved 20 Oct 12:04). Final invoices only (notes not 'DEPOSIT%').
-- Steps: -3 friendly, due day polite, +3 reminder + call task, +7 urgent-professional (amber + banner), +14 owner call (red + sound).
-- Client emails are ALWAYS drafts: owner edits subject/body, approves, then sends once. Never auto-sent.
-- Rollback: docs/db-releases/2026-10-20_invoice_followups_rollback.sql

alter table public.sales_escalations drop constraint if exists sales_escalations_entity_type_check;
alter table public.sales_escalations add constraint sales_escalations_entity_type_check check (entity_type in ('lead','quote','job','invoice'));

alter table public.payment_followups add column if not exists step text, add column if not exists subject text;
alter table public.payment_followups alter column channel set default 'email';
alter table public.payment_followups drop constraint if exists payment_followups_stage_check;
alter table public.payment_followups add constraint payment_followups_stage_check check (stage in (-3,0,3,7,14));
alter table public.payment_followups drop constraint if exists payment_followups_step_check;
alter table public.payment_followups add constraint payment_followups_step_check check (step is null or step in ('pre','due','plus3','plus7','manual'));
create unique index if not exists payment_followups_invoice_step_uq on public.payment_followups(invoice_id, step) where step is not null and step <> 'manual';

-- Due date rule: missing due_date = issue date + 7 days.
create or replace function public._inv_due(p_due date, p_issue date, p_created timestamptz) returns date language sql immutable as $$
  select coalesce(p_due, p_issue + 7, (p_created at time zone 'Africa/Johannesburg')::date + 7) $$;

create or replace function public._inv_rep(p_invoice uuid) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(i.agent_id, q.sales_engineer_id) from public.invoices i left join public.quotes q on q.id = i.quote_id where i.id = p_invoice $$;

-- Step for a days-to-due value (negative = before due). Limits from company_settings.sales_stage_limits.
create or replace function public._inv_step(p_company uuid, p_days int) returns text language sql stable security definer set search_path = public as $$
  select case
    when p_days >= public._hb_limit(p_company,'invOwnerDays',14) then 'plus14'
    when p_days >= public._hb_limit(p_company,'invUrgentDays',7) then 'plus7'
    when p_days >= public._hb_limit(p_company,'invCallDays',3) then 'plus3'
    when p_days >= 0 then 'due'
    when p_days >= -public._hb_limit(p_company,'invPreDays',3) then 'pre'
    else null end $$;

create or replace function public._inv_subject(p_step text, p_no text) returns text language sql immutable as $$
  select case p_step
    when 'pre' then format('Friendly reminder: invoice %s is due soon', p_no)
    when 'due' then format('Invoice %s is due today', p_no)
    when 'plus3' then format('Reminder: invoice %s is now overdue', p_no)
    else format('Urgent: invoice %s is overdue', p_no) end $$;

create or replace function public._inv_message(p_step text, p_name text, p_no text, p_amount numeric, p_due date, p_company text) returns text language sql immutable as $$
  select format(case p_step
    when 'pre' then E'Hi %1$s,\n\nJust a friendly heads-up that invoice %2$s for R%3$s is due on %4$s. If you have already arranged payment, thank you. If you have any questions, just reply to this email.\n\nKind regards,\n%5$s'
    when 'due' then E'Hi %1$s,\n\nA polite reminder that invoice %2$s for R%3$s is due today (%4$s). If you have already paid, thank you and please ignore this message.\n\nKind regards,\n%5$s'
    when 'plus3' then E'Hi %1$s,\n\nOur records show that invoice %2$s for R%3$s, due on %4$s, is still outstanding. Could you please let us know when we can expect payment? If you have already paid, please send us the proof of payment so we can update our records.\n\nKind regards,\n%5$s'
    else E'Hi %1$s,\n\nInvoice %2$s for R%3$s was due on %4$s and is now more than a week overdue. We would really appreciate payment as soon as possible, or a quick reply to let us know when it will be settled. If something is holding up payment, please let us know so we can help.\n\nKind regards,\n%5$s' end,
    coalesce(nullif(btrim(p_name),''),'there'), coalesce(p_no,''), to_char(p_amount,'FM999G999G990D00'), to_char(p_due,'DD Mon YYYY'), coalesce(p_company,'the team')) $$;

-- Open final invoices for the caller's company (sales reps: only their own). Used by the badge, Money due tile and due chips.
create or replace function public.invoice_due_summary() returns table (
  invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, customer_email text, amount_due numeric, due date,
  days int, step text, rep_id uuid, followup_id uuid, followup_status text, followup_step text, followup_subject text, followup_message text)
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := public.get_user_company_id(auth.uid()); v_rep boolean := public.is_sales_rep(auth.uid());
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if auth.uid() is null or v_co is null or public.is_field_tech_only(auth.uid())
     or not (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'dispatcher'::app_role) or v_rep) then return; end if;
  return query
  select i.id, i.invoice_number, i.customer_id, i.customer_name, i.customer_email, public._pf_amount_due(i.id),
    public._inv_due(i.due_date, i.issue_date, i.created_at), v_today - public._inv_due(i.due_date, i.issue_date, i.created_at),
    public._inv_step(i.company_id, v_today - public._inv_due(i.due_date, i.issue_date, i.created_at)), public._inv_rep(i.id),
    f.id, f.status, f.step, f.subject, coalesce(f.approved_message, f.proposed_message)
  from public.invoices i
  left join lateral (select * from public.payment_followups pf where pf.invoice_id = i.id and pf.status in ('pending','approved') order by pf.created_at desc limit 1) f on true
  where i.company_id = v_co and coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
    and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived')
    and public._pf_invoice_sent(i.sent_at, i.sent_method, i.status) and public._pf_amount_due(i.id) > 0
    and (not v_rep or public._inv_rep(i.id) = auth.uid());
end $$;
grant execute on function public.invoice_due_summary() to authenticated;

-- Creates drafts + internal nudges once per step. Runs from process_sales_escalations (every 2 min); dedupe via unique keys.
create or replace function public.process_invoice_followups() returns int language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_days int; v_step text; v_due numeric; v_dd date; v_id uuid; n int := 0;
  v_users uuid[]; v_name text;
begin
  for r in select i.*, c.name as company_name from public.invoices i join public.companies c on c.id = i.company_id
    where coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
      and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived')
      and public._inv_due(i.due_date, i.issue_date, i.created_at) <= v_today + 14
      and public._inv_due(i.due_date, i.issue_date, i.created_at) > v_today - 120 loop
    if not public._pf_invoice_sent(r.sent_at, r.sent_method, r.status) then continue; end if;
    v_dd := public._inv_due(r.due_date, r.issue_date, r.created_at); v_days := v_today - v_dd;
    v_step := public._inv_step(r.company_id, v_days);
    if v_step is null then continue; end if;
    v_due := public._pf_amount_due(r.id);
    if v_due <= 0 then continue; end if;
    v_name := coalesce(nullif(btrim(r.customer_name),''), r.invoice_number, 'Client');
    v_users := public._hb_admins(r.company_id) || array[public._inv_rep(r.id)];
    -- Client draft (pre / due / plus3 / plus7). +14 is a phone call only.
    if v_step <> 'plus14' and not exists (select 1 from public.payment_followups f where f.invoice_id = r.id and f.step = v_step) then
      update public.payment_followups set status = 'cancelled', decision_note = 'superseded by a later step' where invoice_id = r.id and status = 'pending';
      insert into public.payment_followups (company_id, invoice_id, customer_id, customer_name, customer_phone, invoice_number, amount_due, due_date, days_late, stage, step, channel, subject, proposed_message)
        values (r.company_id, r.id, r.customer_id, r.customer_name, r.customer_phone, r.invoice_number, v_due, v_dd, v_days,
          case v_step when 'pre' then -3 when 'due' then 0 when 'plus3' then 3 else 7 end, v_step, 'email',
          public._inv_subject(v_step, r.invoice_number), public._inv_message(v_step, r.customer_name, r.invoice_number, v_due, v_dd, r.company_name))
        on conflict do nothing returning id into v_id;
      if v_id is not null then n := n + 1; end if;
    end if;
    perform public._hb_nudge(r.company_id, 'invoice', r.id, 'inv_'||v_step, 1,
      case when v_step = 'plus14' then public._hb_admins(r.company_id) else v_users end,
      case v_step when 'pre' then 'Invoice due soon' when 'due' then 'Invoice due today' when 'plus3' then 'Call about overdue invoice'
        when 'plus7' then 'Invoice a week overdue' else 'Owner: phone the client' end,
      case v_step when 'pre' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' due '||to_char(v_dd,'DD Mon')||'. Review the friendly reminder.'
        when 'due' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' due today. Review the reminder.'
        when 'plus3' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' '||v_days||' days late. Phone the client and review the reminder.'
        when 'plus7' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' '||v_days||' days late. Review the urgent reminder.'
        else v_name||' · R'||to_char(v_due,'FM999G999G990')||' '||v_days||' days late. Please phone the client personally.' end);
  end loop;
  return n;
end $$;

-- Owner edits subject + body inline before approving (send once stays in pf_claim_send).
drop function if exists public.pf_decide(uuid, boolean, text, text);
create or replace function public.pf_decide(p_id uuid, p_approve boolean, p_message text default null, p_note text default null, p_subject text default null)
returns text language plpgsql security definer set search_path = public as $$
declare f public.payment_followups; v_msg text; v_sub text;
begin
  select * into f from public.payment_followups where id = p_id for update;
  if not found or not public._pf_owner(f.company_id) then raise exception 'Only the company owner can approve follow-ups' using errcode = '42501'; end if;
  if f.status <> 'pending' then raise exception 'Already %', f.status; end if;
  v_msg := coalesce(nullif(btrim(p_message),''), f.proposed_message);
  v_sub := coalesce(nullif(btrim(p_subject),''), f.subject, 'Invoice '||coalesce(f.invoice_number,''));
  if p_approve and (not public._pf_tone_ok(v_msg) or not public._pf_tone_ok(v_sub)) then raise exception 'Please keep the message friendly: no legal, penalty or blacklist wording.'; end if;
  update public.payment_followups set status = case when p_approve then 'approved' else 'declined' end,
    approved_message = case when p_approve then v_msg end, subject = case when p_approve then v_sub else subject end,
    proposed_message = case when p_approve then proposed_message else v_msg end,
    decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
  return case when p_approve then 'approved' else 'declined' end;
end $$;
grant execute on function public.pf_decide(uuid, boolean, text, text, text) to authenticated;

-- pf_claim_send also returns subject + email so the email function can send it.
create or replace function public.pf_claim_send(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.payment_followups; v_email text;
begin
  select * into f from public.payment_followups where id = p_id for update;
  if not found or not (public._pf_office(f.company_id) or public._pf_owner(f.company_id)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if f.status <> 'approved' then raise exception 'This follow-up is % — it needs the owner''s approval first.', f.status; end if;
  if public._pf_amount_due(f.invoice_id) <= 0 then
    update public.payment_followups set status = 'cancelled', decision_note = 'invoice paid before sending' where id = p_id;
    raise exception 'The invoice has been paid since, so nothing was sent.';
  end if;
  select coalesce(nullif(btrim(i.customer_email),''), (select c.email from public.customers c where c.id = i.customer_id)) into v_email from public.invoices i where i.id = f.invoice_id;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'This client has no email address on the invoice.'; end if;
  update public.payment_followups set status = 'sent', sent_at = now(), sent_by = auth.uid(), channel = 'email' where id = p_id;
  return jsonb_build_object('id', f.id, 'message', f.approved_message, 'subject', f.subject, 'email', v_email, 'customer_name', f.customer_name,
    'invoice_number', f.invoice_number, 'invoice_id', f.invoice_id, 'company_id', f.company_id, 'channel', 'email');
end $$;

-- Old daily flagger (3/7 days) is replaced by the step engine.
create or replace function public.pf_flag_overdue() returns integer language sql security definer set search_path = public as $$ select public.process_invoice_followups() $$;

-- Hook into the heartbeat cron: append a call to process_sales_escalations (keeps the live body, idempotent).
do $do$
declare d text;
begin
  select pg_get_functiondef('public.process_sales_escalations()'::regprocedure) into d;
  if position('process_invoice_followups' in d) = 0 then
    d := regexp_replace(d, 'end\s*\$function\$\s*$', E'  perform public.process_invoice_followups();\nend $function$\n');
    execute d;
  end if;
end $do$;
