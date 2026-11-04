-- Keep due dates the user picked (Johan 4 Nov 06:45). Re-runnable.
-- Bug: trg_zz_inv_due_from_terms replaced a deliberately chosen due date when it happened to equal issue+30 (live)
-- / issue+7 or +30 (repo file), using the client's terms. Fix: explicit invoices.due_date_source.
--   'manual' -> the trigger never touches due_date.
--   'terms' / null -> unchanged behaviour (fill when empty or a generic +7/+30 default), and mark 'terms'.
-- Existing invoices are NOT changed (column stays null for them).
alter table public.invoices add column if not exists due_date_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_due_date_source_chk') then
    alter table public.invoices add constraint invoices_due_date_source_chk check (due_date_source in ('manual', 'terms'));
  end if;
end $$;
comment on column public.invoices.due_date_source is 'manual = picked by a person (never auto-replaced); terms = filled from payment terms; null = legacy/unknown';

create or replace function public._inv_due_from_terms() returns trigger language plpgsql security definer set search_path = public as $$
declare v_basis text; v_days int; v_issue date;
begin
  if NEW.due_date_source = 'manual' and NEW.due_date is not null then return NEW; end if;
  v_issue := coalesce(NEW.issue_date, (now() at time zone 'Africa/Johannesburg')::date);
  if NEW.due_date is not null and NEW.due_date not in (v_issue + 30, v_issue + 7) then return NEW; end if;
  select coalesce(NEW.payment_terms_basis, c.payment_terms_basis),
         coalesce(case when NEW.payment_terms_basis is not null then NEW.payment_terms_days end, c.payment_terms_days,
                  nullif((select cs.default_payment_terms_days from public.company_settings cs where cs.company_id = NEW.company_id limit 1), 0), 7)
    into v_basis, v_days from (select 1) x left join public.customers c on c.id = NEW.customer_id;
  if v_basis = 'completion' then return NEW; end if;
  NEW.due_date := v_issue + v_days;
  NEW.due_date_source := 'terms';
  return NEW;
end $$;
drop trigger if exists trg_zz_inv_due_from_terms on public.invoices;
create trigger trg_zz_inv_due_from_terms before insert on public.invoices for each row execute function public._inv_due_from_terms();

-- Changing the due date afterwards is a person's choice too.
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
  update public.invoices set due_date = p_due, due_date_source = 'manual', updated_at = now() where id = p_invoice;
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', v_co, p_invoice, 'invoices', v_uid, jsonb_build_object('due_date', v_old),
          jsonb_build_object('event', 'due_date_changed', 'due_date', p_due, 'reason', nullif(left(trim(coalesce(p_reason, '')), 300), '')));
  return jsonb_build_object('ok', true, 'old', v_old, 'new', p_due);
end $$;
revoke all on function public.set_invoice_due_date(uuid, date, text) from public, anon;
grant execute on function public.set_invoice_due_date(uuid, date, text) to authenticated;
