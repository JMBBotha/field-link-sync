-- Balance due ON COMPLETION (Johan 31 Oct 09:56-09:58).
-- * A balance invoice (one with a deposit) is due on the day the job is completed. Until then it is "Due on completion
--   (installation booked <date>)": never due, never overdue, no reminders.
-- * A manual due date (set_invoice_due_date, logged) still wins: invoices.due_date_manual.
-- * Payment terms (invoice -> client -> company default) now only apply to invoices without a deposit (account / no-deposit clients).
-- * 2 days after completion, still unpaid: in-app alert to admins + a branded reminder draft (step plus2). Admin previews and presses Send.
--   Never sent automatically. Runs inside the existing daily cron "payment-followup-flags".

alter table public.invoices add column if not exists due_date_manual boolean not null default false;

alter table public.payment_followups drop constraint if exists payment_followups_step_check;
alter table public.payment_followups add constraint payment_followups_step_check
  check (step is null or step in ('pre','due','plus2','plus3','plus7','manual'));

-- Jobs linked by quote OR by invoice.
create or replace function public._inv_job_done(p_invoice uuid) returns date
language sql stable security definer set search_path to 'public' as $$
  select case when count(*) > 0 and bool_and(j.completed_at is not null or lower(coalesce(j.status,'')) = 'completed')
    then (max(coalesce(j.completed_at, j.updated_at)) at time zone 'Africa/Johannesburg')::date end
  from public.invoices i join public.jobs j on (j.quote_id = i.quote_id and i.quote_id is not null) or j.invoice_id = i.id
  where i.id = p_invoice and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void') $$;

-- The open job the balance waits for (installation first, then the earliest booked).
create or replace function public._inv_install_job(p_invoice uuid) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select j.id from public.invoices i join public.jobs j on (j.quote_id = i.quote_id and i.quote_id is not null) or j.invoice_id = i.id
  where i.id = p_invoice and lower(coalesce(j.status,'')) not in ('cancelled','canceled','void')
  order by (j.completed_at is null and lower(coalesce(j.status,'')) <> 'completed') desc,
           (coalesce(j.job_type,'') ilike '%install%') desc, j.scheduled_for nulls last limit 1 $$;

create or replace function public._inv_is_balance(p_invoice uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(i.deposit_amount,0) > 0 and coalesce(i.deposit_type,'') <> 'deposit_invoice' from public.invoices i where i.id = p_invoice $$;

create or replace function public._inv_due_eff(p_invoice uuid) returns date
language plpgsql stable security definer set search_path to 'public' as $$
declare i public.invoices; t record;
begin
  select * into i from public.invoices where id = p_invoice; if not found then return null; end if;
  if i.due_date_manual and i.due_date is not null then return i.due_date; end if;
  if coalesce(i.deposit_amount,0) > 0 and coalesce(i.deposit_type,'') <> 'deposit_invoice' then
    return public._inv_job_done(p_invoice);   -- balance: due on completion (null until then)
  end if;
  select * into t from public._inv_terms(p_invoice);
  if t.basis = 'completion' then return public._inv_job_done(p_invoice) + t.days; end if;
  if t.basis = 'invoice' then return coalesce(i.issue_date, (i.created_at at time zone 'Africa/Johannesburg')::date) + t.days; end if;
  return public._inv_due(i.due_date, i.issue_date, i.created_at);
end $$;

create or replace function public.set_invoice_due_date(p_invoice uuid, p_due date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_co uuid; v_old date; v_status text; v_ok boolean; v_man boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select company_id, due_date, status, due_date_manual into v_co, v_old, v_status, v_man from public.invoices where id = p_invoice for update;
  if v_co is null or v_co is distinct from public.get_user_company_id(v_uid) then raise exception 'Invoice not found'; end if;
  v_ok := coalesce(public.is_company_owner(v_uid, v_co), false) or public.has_role(v_uid, 'admin')
          or exists (select 1 from company_members where user_id = v_uid and company_id = v_co and role = 'admin')
          or (public.is_sales_rep(v_uid) and coalesce(public.rep_can_see_invoice(v_uid, p_invoice), false));
  if not v_ok then raise exception 'Only the owner, an admin or the client''s sales rep can change the due date' using errcode = '42501'; end if;
  if v_status in ('void', 'cancelled') then raise exception 'Invoice is %', v_status; end if;
  -- p_due null = clear the manual date (back to the automatic rule: on completion / terms).
  if p_due is null and not v_man then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  if p_due is not null and p_due is not distinct from v_old and v_man then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update public.invoices set due_date = coalesce(p_due, due_date), due_date_manual = p_due is not null, updated_at = now() where id = p_invoice;
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', v_co, p_invoice, 'invoices', v_uid, jsonb_build_object('due_date', v_old, 'manual', v_man),
          jsonb_build_object('event', case when p_due is null then 'due_date_auto' else 'due_date_changed' end, 'due_date', p_due, 'manual', p_due is not null,
                             'reason', nullif(left(trim(coalesce(p_reason, '')), 300), '')));
  if public._inv_due_eff(p_invoice) is null then
    update public.payment_followups set status = 'cancelled', decision_note = 'due on completion' where invoice_id = p_invoice and status = 'pending';
  end if;
  return jsonb_build_object('ok', true, 'old', v_old, 'new', p_due);
end $$;

-- Installation date: admin, office or the client's sales rep. Logged.
create or replace function public.set_job_install_date(p_job uuid, p_at timestamptz, p_reason text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); j public.jobs; v_ok boolean; v_inv uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_at is null then raise exception 'Pick a date'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or j.company_id is distinct from public.get_user_company_id(v_uid) then raise exception 'Job not found'; end if;
  if j.completed_at is not null or lower(coalesce(j.status,'')) in ('completed','cancelled','canceled','void') then raise exception 'This job is %', coalesce(j.status,'closed'); end if;
  select i.id into v_inv from public.invoices i where i.id = j.invoice_id or (j.quote_id is not null and i.quote_id = j.quote_id) limit 1;
  v_ok := coalesce(public.is_company_owner(v_uid, j.company_id), false) or public.has_role(v_uid, 'admin') or public.has_role(v_uid, 'dispatcher')
          or exists (select 1 from company_members where user_id = v_uid and company_id = j.company_id and role = 'admin')
          or (public.is_sales_rep(v_uid) and v_inv is not null and coalesce(public.rep_can_see_invoice(v_uid, v_inv), false));
  if not v_ok then raise exception 'Only admin, office or the client''s sales rep can change the installation date' using errcode = '42501'; end if;
  if p_at is not distinct from j.scheduled_for then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update public.jobs set scheduled_for = p_at,
    scheduled_until = case when j.scheduled_until is not null and j.scheduled_for is not null then j.scheduled_until + (p_at - j.scheduled_for) else j.scheduled_until end,
    status = case when lower(coalesce(j.status,'')) in ('pending','unscheduled','') then 'scheduled' else j.status end,
    updated_at = now() where id = p_job;
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', j.company_id, p_job, 'jobs', v_uid, jsonb_build_object('scheduled_for', j.scheduled_for),
          jsonb_build_object('event', 'install_date_changed', 'scheduled_for', p_at, 'invoice_id', v_inv, 'reason', nullif(left(trim(coalesce(p_reason,'')),300),'')));
  return jsonb_build_object('ok', true, 'old', j.scheduled_for, 'new', p_at);
end $$;

-- Everything the balance block shows, in one call.
create or replace function public.invoice_balance_info(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); i public.invoices; j public.jobs; v_paid numeric; v_dep_paid_at date; v_done date; v_eff date; v_bal numeric;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_admin boolean; v_rep boolean; v_f public.payment_followups; t record;
begin
  if v_uid is null then return null; end if;
  select * into i from public.invoices where id = p_invoice;
  if i.id is null or i.company_id is distinct from public.get_user_company_id(v_uid) or public.is_field_tech_only(v_uid) then return null; end if;
  v_rep := public.is_sales_rep(v_uid);
  if v_rep and not coalesce(public.rep_can_see_invoice(v_uid, p_invoice), false) then return null; end if;
  v_admin := coalesce(public.is_company_owner(v_uid, i.company_id), false) or public.has_role(v_uid, 'admin')
             or exists (select 1 from company_members where user_id = v_uid and company_id = i.company_id and role = 'admin');
  select * into j from public.jobs where id = public._inv_install_job(p_invoice);
  select coalesce(sum(amount),0) into v_paid from public.payments where invoice_id = p_invoice and status in ('paid','succeeded','completed');
  select (min(coalesce(payment_date::timestamptz, created_at)) at time zone 'Africa/Johannesburg')::date into v_dep_paid_at
    from public.payments where invoice_id = p_invoice and status in ('paid','succeeded','completed');
  v_done := public._inv_job_done(p_invoice); v_eff := public._inv_due_eff(p_invoice);
  v_bal := greatest(round(coalesce(i.grand_total,0) - v_paid, 2), 0);
  select * into t from public._inv_terms(p_invoice);
  select * into v_f from public.payment_followups f where f.invoice_id = p_invoice and f.status in ('pending','approved') order by created_at desc limit 1;
  return jsonb_build_object(
    'invoice_id', i.id, 'invoice_number', i.invoice_number, 'status', i.status, 'total', i.grand_total,
    'is_balance', coalesce(i.deposit_amount,0) > 0 and coalesce(i.deposit_type,'') <> 'deposit_invoice',
    'deposit_amount', coalesce(i.deposit_amount,0), 'deposit_paid', least(v_paid, coalesce(i.deposit_amount,0)),
    'deposit_paid_at', case when v_paid > 0 then v_dep_paid_at end, 'paid_total', v_paid, 'balance', v_bal,
    'job_id', j.id, 'job_status', j.status, 'install_at', j.scheduled_for, 'job_done', v_done,
    'due', v_eff, 'due_manual', i.due_date_manual, 'waiting', v_eff is null, 'stored_due', i.due_date,
    'days', case when v_eff is not null then v_today - v_eff end,
    'terms_basis', t.basis, 'terms_days', t.days,
    'reminder_due', v_bal > 0 and v_done is not null and v_today - v_done >= 2 and lower(coalesce(i.status,'')) not in ('paid','void','cancelled'),
    'followup_id', v_f.id, 'followup_status', v_f.status, 'followup_step', v_f.step,
    'can_edit_install', v_admin or public.has_role(v_uid,'dispatcher') or v_rep, 'can_edit_due', v_admin or v_rep, 'is_admin', v_admin);
end $$;

-- Final date in the payment schedule: manual due date, else expected final date, else completion date (null = waiting).
create or replace function public._inv_pay_schedule(p_invoice uuid)
 returns table(invoice_id uuid, has_deposit boolean, deposit_amount numeric, deposit_date date, deposit_date_auto boolean, deposit_paid numeric, deposit_outstanding numeric, deposit_status text, final_amount numeric, final_date date, final_date_auto boolean, final_after_days integer, final_paid numeric, final_outstanding numeric, final_status text, terms_days integer)
 language plpgsql stable security definer set search_path to 'public' as $function$
DECLARE i public.invoices; t record; v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_paid numeric; v_cred numeric := 0; v_dep numeric; v_fin numeric; v_base date; v_ddate date; v_fdays int; v_fdate date; v_cust_days int;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice; IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO t FROM public._inv_terms(p_invoice);
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE payments.invoice_id = p_invoice AND status IN ('paid','succeeded','completed');
  SELECT COALESCE(SUM(total),0) INTO v_cred FROM public.credit_notes cn WHERE cn.invoice_id = p_invoice AND COALESCE(cn.status,'') <> 'void';
  SELECT c.final_after_days INTO v_cust_days FROM public.customers c WHERE c.id = i.customer_id;
  v_dep := CASE WHEN COALESCE(i.deposit_amount,0) > 0 THEN round(i.deposit_amount,2) ELSE 0 END;
  v_fin := GREATEST(0, round(COALESCE(i.grand_total,0) - v_dep - v_cred, 2));
  v_base := COALESCE(i.issue_date, (i.created_at at time zone 'Africa/Johannesburg')::date) + COALESCE(t.days, 30);
  v_ddate := COALESCE(i.expected_deposit_date, v_base);
  v_fdays := COALESCE(i.final_after_days, v_cust_days, 30);
  v_fdate := CASE WHEN v_dep > 0 THEN COALESCE(CASE WHEN i.due_date_manual THEN i.due_date END, i.expected_final_date, public._inv_job_done(p_invoice))
                  ELSE COALESCE(i.expected_final_date, v_ddate) END;
  invoice_id := i.id; has_deposit := v_dep > 0; terms_days := COALESCE(t.days, 30);
  deposit_amount := v_dep; deposit_date := CASE WHEN v_dep > 0 THEN v_ddate END; deposit_date_auto := i.expected_deposit_date IS NULL;
  deposit_paid := LEAST(v_paid, v_dep); deposit_outstanding := v_dep - LEAST(v_paid, v_dep);
  final_amount := v_fin; final_date := v_fdate; final_date_auto := i.expected_final_date IS NULL AND NOT i.due_date_manual AND v_fdate IS NOT NULL; final_after_days := v_fdays;
  final_paid := LEAST(GREATEST(v_paid - v_dep, 0), v_fin); final_outstanding := v_fin - LEAST(GREATEST(v_paid - v_dep, 0), v_fin);
  deposit_status := CASE WHEN v_dep = 0 THEN 'none' WHEN deposit_outstanding <= 0.005 THEN 'paid'
    WHEN lower(COALESCE(i.status,'')) IN ('void','cancelled') THEN 'void' WHEN v_ddate < v_today THEN 'overdue'
    WHEN deposit_paid > 0 THEN 'part_paid' ELSE 'outstanding' END;
  final_status := CASE WHEN lower(COALESCE(i.status,'')) IN ('void','cancelled') THEN 'void' WHEN final_outstanding <= 0.005 THEN 'paid'
    WHEN v_fdate IS NULL THEN 'unscheduled' WHEN v_fdate < v_today THEN 'overdue' WHEN final_paid > 0 THEN 'part_paid' ELSE 'outstanding' END;
  IF lower(COALESCE(i.status,'')) IN ('void','cancelled') AND v_dep > 0 AND deposit_status <> 'paid' THEN deposit_status := 'void'; END IF;
  IF lower(COALESCE(i.status,'')) = 'draft' THEN
    IF deposit_status IN ('overdue','outstanding') THEN deposit_status := 'not_sent'; END IF;
    IF final_status IN ('overdue','outstanding') THEN final_status := 'not_sent'; END IF;
  END IF;
  RETURN NEXT;
END $function$;

create or replace function public._inv_subject(p_step text, p_no text) returns text language sql immutable as $$
  select case p_step
    when 'pre' then format('Friendly reminder: invoice %s is due soon', p_no)
    when 'due' then format('Invoice %s is due today', p_no)
    when 'plus2' then format('Payment reminder: balance on invoice %s', p_no)
    when 'plus3' then format('Reminder: invoice %s is now overdue', p_no)
    else format('Urgent: invoice %s is overdue', p_no) end $$;

create or replace function public._inv_message(p_step text, p_name text, p_no text, p_amount numeric, p_due date, p_company text) returns text language sql immutable as $$
  select format(case p_step
    when 'pre' then E'Hi %1$s,\n\nJust a friendly heads-up that invoice %2$s for R%3$s is due on %4$s. If you have already arranged payment, thank you. If you have any questions, just reply to this email.\n\nKind regards,\n%5$s'
    when 'due' then E'Hi %1$s,\n\nA polite reminder that invoice %2$s for R%3$s is due today (%4$s). If you have already paid, thank you and please ignore this message.\n\nKind regards,\n%5$s'
    when 'plus2' then E'Hi %1$s,\n\nThank you again for choosing us. Your job was completed on %4$s and the balance of R%3$s on invoice %2$s is now due. If you have already paid, thank you, and please send us the proof of payment so we can update our records.\n\nKind regards,\n%5$s'
    when 'plus3' then E'Hi %1$s,\n\nOur records show that invoice %2$s for R%3$s, due on %4$s, is still outstanding. Could you please let us know when we can expect payment? If you have already paid, please send us the proof of payment so we can update our records.\n\nKind regards,\n%5$s'
    else E'Hi %1$s,\n\nInvoice %2$s for R%3$s was due on %4$s and is now more than a week overdue. We would really appreciate payment as soon as possible, or a quick reply to let us know when it will be settled. If something is holding up payment, please let us know so we can help.\n\nKind regards,\n%5$s' end,
    coalesce(nullif(btrim(p_name),''),'there'), coalesce(p_no,''), to_char(p_amount,'FM999G999G990D00'), to_char(p_due,'DD Mon YYYY'), coalesce(p_company,'the team')) $$;

-- Daily (cron payment-followup-flags). Balance invoices: nothing before completion; plus2 at completion + 2 days, then plus7 / plus14.
create or replace function public.process_invoice_followups() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_today date := (now() at time zone 'Africa/Johannesburg')::date; v_days int; v_step text; v_due numeric; v_dd date; v_id uuid; n int := 0;
  v_users uuid[]; v_name text; v_bal boolean;
begin
  -- Old-rule drafts on invoices now waiting are hidden (invoice_due_summary only joins drafts when a due date exists); not auto-cancelled.
  for r in select i.*, c.name as company_name, public._inv_due_eff(i.id) as eff_due from public.invoices i join public.companies c on c.id = i.company_id
    where coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
      and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived') loop
    v_dd := r.eff_due;
    if v_dd is null or v_dd > v_today + 14 or v_dd <= v_today - 120 then continue; end if;
    if not public._pf_invoice_sent(r.sent_at, r.sent_method, r.status) then continue; end if;
    v_days := v_today - v_dd;
    v_bal := coalesce(r.deposit_amount,0) > 0 and not r.due_date_manual;
    if v_bal then
      v_step := case when v_days < 2 then null when v_days < 7 then 'plus2' else public._inv_step(r.company_id, v_days) end;
    else
      v_step := public._inv_step(r.company_id, v_days);
    end if;
    if v_step is null then continue; end if;
    v_due := public._pf_amount_due(r.id);
    if v_due <= 0 then continue; end if;
    v_name := coalesce(nullif(btrim(r.customer_name),''), r.invoice_number, 'Client');
    v_users := public._hb_admins(r.company_id) || array[public._inv_rep(r.id)];
    if v_step <> 'plus14' and not exists (select 1 from public.payment_followups f where f.invoice_id = r.id and f.step = v_step) then
      update public.payment_followups set status = 'cancelled', decision_note = 'superseded by a later step' where invoice_id = r.id and status = 'pending';
      insert into public.payment_followups (company_id, invoice_id, customer_id, customer_name, customer_phone, invoice_number, amount_due, due_date, days_late, stage, step, channel, subject, proposed_message)
        values (r.company_id, r.id, r.customer_id, r.customer_name, r.customer_phone, r.invoice_number, v_due, v_dd, v_days,
          case v_step when 'pre' then -3 when 'due' then 0 when 'plus2' then 2 when 'plus3' then 3 else 7 end, v_step, 'email',
          public._inv_subject(v_step, r.invoice_number), public._inv_message(v_step, r.customer_name, r.invoice_number, v_due, v_dd, r.company_name))
        on conflict do nothing returning id into v_id;
      if v_id is not null then n := n + 1; end if;
    end if;
    perform public._hb_nudge(r.company_id, 'invoice', r.id, 'inv_'||v_step, 1,
      case when v_step in ('plus14','plus2') then public._hb_admins(r.company_id) else v_users end,
      case v_step when 'pre' then 'Invoice due soon' when 'due' then 'Invoice due today' when 'plus2' then 'Balance unpaid after completion'
        when 'plus3' then 'Call about overdue invoice' when 'plus7' then 'Invoice a week overdue' else 'Owner: phone the client' end,
      case v_step when 'pre' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' due '||to_char(v_dd,'DD Mon')||'. Review the friendly reminder.'
        when 'due' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' due today. Review the reminder.'
        when 'plus2' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' still unpaid '||v_days||' days after the job was completed ('||to_char(v_dd,'DD Mon')||'). Preview and send the payment reminder.'
        when 'plus3' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' '||v_days||' days late. Phone the client and review the reminder.'
        when 'plus7' then v_name||' · R'||to_char(v_due,'FM999G999G990')||' '||v_days||' days late. Review the urgent reminder.'
        else v_name||' · R'||to_char(v_due,'FM999G999G990')||' '||v_days||' days late. Please phone the client personally.' end);
  end loop;
  return n;
end $function$;

drop function if exists public.invoice_due_summary();
create function public.invoice_due_summary()
 returns table(invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, customer_email text, amount_due numeric, due date, days integer, step text, rep_id uuid, followup_id uuid, followup_status text, followup_step text, followup_subject text, followup_message text, terms_basis text, terms_days integer, waiting boolean, install_at timestamptz, on_completion boolean)
 language plpgsql stable security definer set search_path to 'public' as $function$
declare v_co uuid := public.get_user_company_id(auth.uid()); v_rep boolean := public.is_sales_rep(auth.uid());
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if auth.uid() is null or v_co is null or public.is_field_tech_only(auth.uid())
     or not (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'dispatcher'::app_role) or v_rep) then return; end if;
  return query
  select x.id, x.invoice_number, x.customer_id, x.customer_name, x.customer_email, x.amt, x.dd, v_today - x.dd,
    case when x.dd is null then null when x.bal and not x.due_date_manual then (case when v_today - x.dd < 2 then null when v_today - x.dd < 7 then 'plus2' else public._inv_step(x.company_id, v_today - x.dd) end)
         else public._inv_step(x.company_id, v_today - x.dd) end, x.rep,
    f.id, f.status, f.step, f.subject, coalesce(f.approved_message, f.proposed_message), (x.t).basis, (x.t).days, x.dd is null,
    (select j.scheduled_for from public.jobs j where j.id = public._inv_install_job(x.id)), x.bal and not x.due_date_manual
  from (select i.*, public._pf_amount_due(i.id) amt, public._inv_due_eff(i.id) dd, public._inv_rep(i.id) rep, public._inv_terms(i.id) t,
               coalesce(i.deposit_amount,0) > 0 bal
        from public.invoices i
        where i.company_id = v_co and coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
          and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived')
          and public._pf_invoice_sent(i.sent_at, i.sent_method, i.status)) x
  left join lateral (select * from public.payment_followups pf where pf.invoice_id = x.id and pf.status in ('pending','approved') and x.dd is not null order by pf.created_at desc limit 1) f on true
  where x.amt > 0 and (not v_rep or x.rep = auth.uid() or public.rep_can_see_invoice(auth.uid(), x.id));
end $function$;
grant execute on function public.invoice_due_summary() to authenticated;

-- Payment reminder on the shared branded email (brandedEmail.ts). Never automatic: an admin opens the preview and presses Send.
-- preview: returns subject, message and the shared layout (rendered in the app with renderBrandedEmail).
-- send: p_html = the exact branded html the admin previewed; posted to send-transactional-email; logged.
create or replace function public.send_payment_reminder(p_followup uuid, p_mode text default 'preview', p_html text default null, p_subject text default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); f public.payment_followups; inv public.invoices; v_admin boolean; v_pre jsonb; v_layout jsonb;
  v_subject text; v_msg text; v_to text; v_token uuid; v_req bigint; v_tok uuid;
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_mode not in ('preview','send') then raise exception 'Unknown mode'; end if;
  select * into f from public.payment_followups where id = p_followup for update;
  if f.id is null or f.company_id is distinct from public.get_user_company_id(v_uid) then raise exception 'Reminder not found'; end if;
  v_admin := coalesce(public.is_company_owner(v_uid, f.company_id), false) or public.has_role(v_uid, 'admin') or public._pf_owner(f.company_id)
             or exists (select 1 from company_members where user_id = v_uid and company_id = f.company_id and role = 'admin');
  if not v_admin then raise exception 'Only an admin can send payment reminders' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = f.invoice_id;
  if lower(coalesce(inv.status,'')) in ('paid','void','cancelled') or public._pf_amount_due(f.invoice_id) <= 0 then
    update public.payment_followups set status = 'cancelled', decision_note = 'invoice paid or void' where id = f.id and status in ('pending','approved');
    raise exception 'This invoice is paid or void, so nothing was sent.';
  end if;
  if f.status not in ('pending','approved') then raise exception 'This reminder is already %', f.status; end if;
  if public._inv_due_eff(f.invoice_id) is null then raise exception 'Not due yet: the balance is due on completion of the job. Decline this old reminder.'; end if;
  v_subject := coalesce(nullif(btrim(p_subject),''), f.subject, 'Payment reminder: invoice ' || coalesce(f.invoice_number,''));
  v_msg := coalesce(nullif(btrim(p_message),''), f.approved_message, f.proposed_message, '');
  v_pre := public.send_final_invoice_email(f.invoice_id, null, 'preview');
  v_to := v_pre->>'to';
  v_layout := (v_pre->'layout') || jsonb_build_object('template', 'payment_reminder', 'title', v_subject, 'kicker', 'Payment reminder')
              || jsonb_build_object('data', (v_pre->'layout'->'data') || jsonb_build_object('message', v_msg, 'dueDate', to_char(coalesce(f.due_date, public._inv_due_eff(f.invoice_id)), 'FMDD FMMonth YYYY')));
  if p_mode = 'preview' then
    return jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'message', v_msg, 'layout', v_layout, 'step', f.step, 'status', f.status);
  end if;
  if p_html is null or length(p_html) < 200 or p_html !~* 'payment reminder' then raise exception 'Open the preview first, then press Send'; end if;
  -- Real link for the client (preview shows a placeholder).
  if inv.customer_id is not null then
    select token into v_tok from customer_tokens where customer_id = inv.customer_id and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
    if v_tok is null then insert into customer_tokens (customer_id) values (inv.customer_id) returning token into v_tok; end if;
    p_html := replace(p_html, 'https://field-link-sync.lovable.app/customer/…/invoice/', 'https://field-link-sync.lovable.app/customer/' || v_tok::text || '/invoice/');
  end if;
  select email_webhook_token into v_token from public.app_webhook_config where id = 1;
  if v_token is null then raise exception 'Email is not set up'; end if;
  select net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', p_html, 'signature_mode', 'reminder', 'sender_user_id', v_uid::text, 'company_id', f.company_id)) into v_req;
  update public.payment_followups set status = 'sent', sent_at = now(), sent_by = v_uid, channel = 'email', subject = v_subject,
    approved_message = v_msg, decided_by = coalesce(decided_by, v_uid), decided_at = coalesce(decided_at, now()) where id = f.id;
  insert into public.email_events (email_id, event_type, recipient_email, event_data)
  values ('net:' || v_req::text, 'payment_reminder_queued', v_to, jsonb_build_object('invoice_id', f.invoice_id, 'invoice_number', f.invoice_number, 'followup_id', f.id, 'step', f.step, 'net_request_id', v_req, 'by', v_uid));
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', f.company_id, f.invoice_id, 'invoices', v_uid, null, jsonb_build_object('event', 'payment_reminder_sent', 'followup_id', f.id, 'step', f.step, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req));
  return jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'sent_at', now());
end $$;

revoke execute on function public.send_payment_reminder(uuid, text, text, text, text) from anon;
revoke execute on function public.set_job_install_date(uuid, timestamptz, text) from anon;
revoke execute on function public.invoice_balance_info(uuid) from anon;
