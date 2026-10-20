-- Rollback for 20261020140000_client_payment_terms.sql (restores 20261020130000 versions)
drop function if exists public.set_customer_payment_terms(uuid,text,int); drop function if exists public.set_invoice_payment_terms(uuid,text,int);
drop function if exists public.invoice_due_summary();
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

drop function if exists public._inv_cancel_waiting_drafts(uuid); drop function if exists public._inv_due_eff(uuid); drop function if exists public._inv_job_done(uuid); drop function if exists public._inv_terms(uuid);
alter table public.invoices drop constraint if exists invoices_payment_terms_chk, drop column if exists payment_terms_basis, drop column if exists payment_terms_days;
alter table public.customers drop constraint if exists customers_payment_terms_chk, drop column if exists payment_terms_basis, drop column if exists payment_terms_days;
-- Drafts cancelled with note 'waiting for job completion (payment terms)' are not auto-restored; the engine recreates current-step drafts on next run.
