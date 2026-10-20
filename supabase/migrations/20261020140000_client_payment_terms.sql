-- Client payment terms (Johan approved 20 Oct 13:30). customers.payment_terms_basis ('invoice'|'completion') + days; optional per-invoice override.
-- 'completion': final invoice has no due date / no drafts / no nudges until its job (via quote_id) is completed; then due = completion + days.
-- Deposit invoices unchanged. Everything stays approval-gated. Rollback: docs/db-releases/2026-10-20_client_payment_terms_rollback.sql
alter table public.customers add column if not exists payment_terms_basis text, add column if not exists payment_terms_days int;
alter table public.customers drop constraint if exists customers_payment_terms_chk;
alter table public.customers add constraint customers_payment_terms_chk check ((payment_terms_basis is null or payment_terms_basis in ('invoice','completion')) and (payment_terms_days is null or payment_terms_days between 0 and 365));
alter table public.invoices add column if not exists payment_terms_basis text, add column if not exists payment_terms_days int;
alter table public.invoices drop constraint if exists invoices_payment_terms_chk;
alter table public.invoices add constraint invoices_payment_terms_chk check ((payment_terms_basis is null or payment_terms_basis in ('invoice','completion')) and (payment_terms_days is null or payment_terms_days between 0 and 365));

-- Effective terms for an invoice: invoice override > client terms > null (old rule: due_date or issue + 7).
create or replace function public._inv_terms(p_invoice uuid, out basis text, out days int) language sql stable security definer set search_path = public as $$
  select coalesce(i.payment_terms_basis, c.payment_terms_basis),
         coalesce(case when i.payment_terms_basis is not null then i.payment_terms_days end, c.payment_terms_days,
                  (select cs.default_payment_terms_days from public.company_settings cs where cs.company_id = i.company_id limit 1), 7)
  from public.invoices i left join public.customers c on c.id = i.customer_id where i.id = p_invoice $$;

-- Completion date of the invoice's job(s): all non-cancelled jobs on the quote completed -> latest completed_at; else null.
create or replace function public._inv_job_done(p_invoice uuid) returns date language sql stable security definer set search_path = public as $$
  select case when count(*) > 0 and bool_and(j.completed_at is not null or lower(coalesce(j.status,'')) = 'completed')
    then (max(coalesce(j.completed_at, j.updated_at)) at time zone 'Africa/Johannesburg')::date end
  from public.invoices i join public.jobs j on j.quote_id = i.quote_id and i.quote_id is not null
  where i.id = p_invoice and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void') $$;

-- Effective due date. NULL = waiting for job completion (no reminders).
create or replace function public._inv_due_eff(p_invoice uuid) returns date language plpgsql stable security definer set search_path = public as $$
declare i public.invoices; t record;
begin
  select * into i from public.invoices where id = p_invoice; if not found then return null; end if;
  select * into t from public._inv_terms(p_invoice);
  if t.basis = 'completion' then return public._inv_job_done(p_invoice) + t.days; end if;
  if t.basis = 'invoice' then return coalesce(i.issue_date, (i.created_at at time zone 'Africa/Johannesburg')::date) + t.days; end if;
  return public._inv_due(i.due_date, i.issue_date, i.created_at);
end $$;

-- Owner/admin edits client terms (null basis = back to company default).
create or replace function public.set_customer_payment_terms(p_customer uuid, p_basis text, p_days int) returns void language plpgsql security definer set search_path = public as $$
declare v_co uuid;
begin
  select company_id into v_co from public.customers where id = p_customer;
  if v_co is null or v_co <> public.get_user_company_id(auth.uid()) or not public.has_role(auth.uid(),'admin'::app_role) then raise exception 'Only the owner or an admin can change payment terms' using errcode='42501'; end if;
  update public.customers set payment_terms_basis = p_basis, payment_terms_days = case when p_basis is null then null else p_days end where id = p_customer;
  perform public._inv_cancel_waiting_drafts(v_co);
end $$;
create or replace function public.set_invoice_payment_terms(p_invoice uuid, p_basis text, p_days int) returns void language plpgsql security definer set search_path = public as $$
declare v_co uuid;
begin
  select company_id into v_co from public.invoices where id = p_invoice;
  if v_co is null or v_co <> public.get_user_company_id(auth.uid()) or not public.has_role(auth.uid(),'admin'::app_role) then raise exception 'Only the owner or an admin can change payment terms' using errcode='42501'; end if;
  update public.invoices set payment_terms_basis = p_basis, payment_terms_days = case when p_basis is null then null else p_days end where id = p_invoice;
  perform public._inv_cancel_waiting_drafts(v_co);
end $$;

-- Undecided drafts for invoices now waiting on completion get cancelled.
create or replace function public._inv_cancel_waiting_drafts(p_company uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.payment_followups f set status = 'cancelled', decision_note = 'waiting for job completion (payment terms)'
  where f.company_id = p_company and f.status = 'pending' and (public._inv_terms(f.invoice_id)).basis = 'completion' and public._inv_due_eff(f.invoice_id) is null;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public._inv_cancel_waiting_drafts(uuid) from public, anon, authenticated;
grant execute on function public.set_customer_payment_terms(uuid,text,int) to authenticated;
grant execute on function public.set_invoice_payment_terms(uuid,text,int) to authenticated;

drop function if exists public.invoice_due_summary();
create or replace function public.invoice_due_summary() returns table (
  invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, customer_email text, amount_due numeric, due date,
  days int, step text, rep_id uuid, followup_id uuid, followup_status text, followup_step text, followup_subject text, followup_message text,
  terms_basis text, terms_days int, waiting boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_co uuid := public.get_user_company_id(auth.uid()); v_rep boolean := public.is_sales_rep(auth.uid());
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if auth.uid() is null or v_co is null or public.is_field_tech_only(auth.uid())
     or not (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'dispatcher'::app_role) or v_rep) then return; end if;
  return query
  select x.id, x.invoice_number, x.customer_id, x.customer_name, x.customer_email, x.amt, x.dd, v_today - x.dd,
    case when x.dd is null then null else public._inv_step(x.company_id, v_today - x.dd) end, x.rep,
    f.id, f.status, f.step, f.subject, coalesce(f.approved_message, f.proposed_message), (x.t).basis, (x.t).days, x.dd is null
  from (select i.*, public._pf_amount_due(i.id) amt, public._inv_due_eff(i.id) dd, public._inv_rep(i.id) rep, public._inv_terms(i.id) t
        from public.invoices i
        where i.company_id = v_co and coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
          and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived')
          and public._pf_invoice_sent(i.sent_at, i.sent_method, i.status)) x
  left join lateral (select * from public.payment_followups pf where pf.invoice_id = x.id and pf.status in ('pending','approved') and x.dd is not null order by pf.created_at desc limit 1) f on true
  where x.amt > 0 and (not v_rep or x.rep = auth.uid());
end $$;
grant execute on function public.invoice_due_summary() to authenticated;

create or replace function public.process_invoice_followups() returns int language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_days int; v_step text; v_due numeric; v_dd date; v_id uuid; n int := 0;
  v_users uuid[]; v_name text;
begin
  for r in select i.*, c.name as company_name, public._inv_due_eff(i.id) as eff_due from public.invoices i join public.companies c on c.id = i.company_id
    where coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
      and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived') loop
    v_dd := r.eff_due;
    if v_dd is null or v_dd > v_today + 14 or v_dd <= v_today - 120 then continue; end if;
    if not public._pf_invoice_sent(r.sent_at, r.sent_method, r.status) then continue; end if;
    v_days := v_today - v_dd;
    v_step := public._inv_step(r.company_id, v_days);
    if v_step is null then continue; end if;
    v_due := public._pf_amount_due(r.id);
    if v_due <= 0 then continue; end if;
    v_name := coalesce(nullif(btrim(r.customer_name),''), r.invoice_number, 'Client');
    v_users := public._hb_admins(r.company_id) || array[public._inv_rep(r.id)];
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
