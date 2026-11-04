-- ROLLBACK for 20261104070000_invoice_due_date_source.sql (do NOT run as a forward migration).
-- Restores the trigger function exactly as it is live on 4 Nov 2026 (overwrites only issue+30), and set_invoice_due_date
-- without due_date_source, then drops the column. Roll back the front end first (it sends due_date_source).
begin;
create or replace function public._inv_due_from_terms() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_basis text; v_days int; v_issue date;
begin
  v_issue := coalesce(NEW.issue_date, (now() at time zone 'Africa/Johannesburg')::date);
  if NEW.due_date is not null and NEW.due_date <> v_issue + 30 then return NEW; end if;
  select coalesce(NEW.payment_terms_basis, c.payment_terms_basis),
         coalesce(case when NEW.payment_terms_basis is not null then NEW.payment_terms_days end, c.payment_terms_days,
                  nullif((select cs.default_payment_terms_days from public.company_settings cs where cs.company_id = NEW.company_id limit 1), 0), 7)
    into v_basis, v_days from (select 1) x left join public.customers c on c.id = NEW.customer_id;
  if v_basis = 'completion' then return NEW; end if;
  NEW.due_date := v_issue + v_days;
  return NEW;
end $function$;
create or replace function public.set_invoice_due_date(p_invoice uuid, p_due date, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_co uuid; v_old date; v_status text; v_ok boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_due is null then raise exception 'Pick a due date'; end if;
  select company_id, due_date, status into v_co, v_old, v_status from public.invoices where id = p_invoice for update;
  if v_co is null or v_co is distinct from public.get_user_company_id(v_uid) then raise exception 'Invoice not found'; end if;
  v_ok := coalesce(public.is_company_owner(v_uid, v_co), false) or public.has_role(v_uid, 'admin')
          or exists (select 1 from company_members where user_id = v_uid and company_id = v_co and role = 'admin')
          or (public.is_sales_rep(v_uid) and coalesce(public.rep_can_see_invoice(v_uid, p_invoice), false));
  if not v_ok then raise exception 'Only the owner, an admin or the client''s sales rep can change the due date' using errcode = '42501'; end if;
  if v_status in ('void', 'cancelled') then raise exception 'Invoice is %', v_status; end if;
  if p_due is not distinct from v_old then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  update public.invoices set due_date = p_due, updated_at = now() where id = p_invoice;
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', v_co, p_invoice, 'invoices', v_uid, jsonb_build_object('due_date', v_old),
          jsonb_build_object('event', 'due_date_changed', 'due_date', p_due, 'reason', nullif(left(trim(coalesce(p_reason, '')), 300), '')));
  return jsonb_build_object('ok', true, 'old', v_old, 'new', p_due);
end $$;
revoke all on function public.set_invoice_due_date(uuid, date, text) from public, anon;
grant execute on function public.set_invoice_due_date(uuid, date, text) to authenticated;
alter table public.invoices drop constraint if exists invoices_due_date_source_chk;
alter table public.invoices drop column if exists due_date_source;
commit;
