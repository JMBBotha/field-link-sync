-- Agreements phase 2 (Johan 18 Oct 2026 20:07): contract instances that auto-fill from a client
-- and optionally one or more invoices / jobs of the SAME client.
-- * Issuing company = the signed-in user's company; only that company's staff see its contracts.
-- * Techs: no access. Sales reps: only clients they can see (rep_can_see_customer).
-- * Per-instance edits live on the instance; the template is never changed.
-- * Creating an instance never creates/activates a service_agreement, job or reminder
--   (no triggers on other tables; service_agreement_id is only a user-set link).

create table if not exists public.agreement_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  template_id uuid references public.agreement_templates(id) on delete set null,
  template_version integer,
  template_name text,
  contract_number text not null,
  title text not null default 'Service contract',
  status text not null default 'draft' check (status in ('draft','issued','signed','void')),
  start_date date,
  frequency text,
  plan text,
  client_snapshot jsonb not null default '{}'::jsonb,
  units jsonb not null default '[]'::jsonb,
  sections jsonb not null default '[]'::jsonb,
  source_invoice_ids uuid[] not null default '{}',
  source_job_ids uuid[] not null default '{}',
  service_agreement_id uuid references public.service_agreements(id) on delete set null,
  notes text,
  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, contract_number)
);
create index if not exists agreement_contracts_customer_idx on public.agreement_contracts(customer_id);
create index if not exists agreement_contracts_company_idx on public.agreement_contracts(company_id, created_at desc);

create or replace function public.can_see_agreement_contract(_uid uuid, _company uuid, _customer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null
    and _company = public.get_user_company_id(_uid)
    and not public.is_field_tech_only(_uid)
    and (not public.is_sales_rep(_uid) or public.rep_can_see_customer(_uid, _customer))
$$;
revoke all on function public.can_see_agreement_contract(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_see_agreement_contract(uuid, uuid, uuid) to authenticated;

alter table public.agreement_contracts enable row level security;
drop policy if exists agc_select on public.agreement_contracts;
create policy agc_select on public.agreement_contracts for select to authenticated
  using (public.can_see_agreement_contract(auth.uid(), company_id, customer_id));
drop policy if exists agc_insert on public.agreement_contracts;
create policy agc_insert on public.agreement_contracts for insert to authenticated
  with check (public.can_see_agreement_contract(auth.uid(), company_id, customer_id));
drop policy if exists agc_update on public.agreement_contracts;
create policy agc_update on public.agreement_contracts for update to authenticated
  using (public.can_see_agreement_contract(auth.uid(), company_id, customer_id))
  with check (public.can_see_agreement_contract(auth.uid(), company_id, customer_id));
drop policy if exists agc_delete on public.agreement_contracts;
create policy agc_delete on public.agreement_contracts for delete to authenticated
  using (public.can_see_agreement_contract(auth.uid(), company_id, customer_id)
         and public.has_role(auth.uid(), 'admin'::app_role) and status in ('draft','void'));
revoke all on public.agreement_contracts from anon;
grant select, insert, update, delete on public.agreement_contracts to authenticated;

-- Integrity guard (runs with full visibility): same client + same company for every source,
-- identity fields frozen after creation.
create or replace function public.agreement_contracts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id or new.customer_id <> old.customer_id
       or new.source_invoice_ids is distinct from old.source_invoice_ids
       or new.source_job_ids is distinct from old.source_job_ids
       or new.template_id is distinct from old.template_id
       or new.template_version is distinct from old.template_version
       or new.contract_number <> old.contract_number then
      raise exception 'Client, company, template and source invoices/jobs of a contract cannot be changed' using errcode = '42501';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
  end if;
  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then
    raise exception 'Client does not belong to this company' using errcode = '42501';
  end if;
  if exists (select 1 from public.invoices i where i.id = any(new.source_invoice_ids)
             and (i.customer_id is distinct from new.customer_id or i.company_id is distinct from new.company_id))
     or (select count(*) from public.invoices i where i.id = any(new.source_invoice_ids)) <> coalesce(array_length(new.source_invoice_ids, 1), 0) then
    raise exception 'All selected invoices must belong to the same client' using errcode = '22023';
  end if;
  if exists (select 1 from public.jobs j where j.id = any(new.source_job_ids)
             and (j.customer_id is distinct from new.customer_id or j.company_id is distinct from new.company_id))
     or (select count(*) from public.jobs j where j.id = any(new.source_job_ids)) <> coalesce(array_length(new.source_job_ids, 1), 0) then
    raise exception 'All selected jobs must belong to the same client' using errcode = '22023';
  end if;
  if new.service_agreement_id is not null and not exists (
       select 1 from public.service_agreements a where a.id = new.service_agreement_id
       and a.customer_id = new.customer_id and a.company_id = new.company_id) then
    raise exception 'Linked agreement must be for the same client' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists agreement_contracts_guard on public.agreement_contracts;
create trigger agreement_contracts_guard before insert or update on public.agreement_contracts
  for each row execute function public.agreement_contracts_guard();

-- Pure helper: frequency label
create or replace function public.agreement_frequency_label(_f text)
returns text language sql immutable as $$
  select case _f when 'monthly' then 'Monthly' when 'quarterly' then 'Quarterly (4 visits a year)'
    when 'biannual' then 'Twice a year' when 'annual' then 'Once a year' else coalesce(_f, '') end
$$;

-- Create = SECURITY INVOKER: every read below goes through the caller's own RLS, so a user
-- can only build a contract from a template, client, invoices and jobs they can already see.
create or replace function public.create_agreement_contract(
  _template_id uuid, _customer_id uuid, _invoice_ids uuid[] default '{}', _job_ids uuid[] default '{}',
  _start_date date default current_date, _frequency text default 'annual', _service_agreement_id uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid := public.get_user_company_id(auth.uid());
  v_tpl record;
  v_cust record;
  v_inv_ids uuid[] := coalesce(_invoice_ids, '{}');
  v_job_ids uuid[] := coalesce(_job_ids, '{}');
  v_sections jsonb;
  v_units jsonb;
  v_client jsonb;
  v_sites text;
  v_number text;
  v_seq int;
  v_id uuid;
  v_vat text;
begin
  if v_uid is null or v_company is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if public.is_field_tech_only(v_uid) then raise exception 'Technicians cannot create contracts' using errcode = '42501'; end if;

  select id, name, version, status into v_tpl from public.agreement_templates where id = _template_id;
  if not found or v_tpl.status = 'archived' then raise exception 'Template not available' using errcode = 'P0002'; end if;

  select * into v_cust from public.customers where id = _customer_id and company_id = v_company;
  if not found then raise exception 'Client not found in your company' using errcode = 'P0002'; end if;

  if (select count(*) from public.invoices where id = any(v_inv_ids)) <> coalesce(array_length(v_inv_ids, 1), 0) then
    raise exception 'One or more selected invoices are not available' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.invoices where id = any(v_inv_ids) and customer_id is distinct from _customer_id) then
    raise exception 'All selected invoices must belong to the same client' using errcode = '22023';
  end if;
  if (select count(*) from public.jobs where id = any(v_job_ids)) <> coalesce(array_length(v_job_ids, 1), 0) then
    raise exception 'One or more selected jobs are not available' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.jobs where id = any(v_job_ids) and customer_id is distinct from _customer_id) then
    raise exception 'All selected jobs must belong to the same client' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('doc_kind', s.doc_kind, 'position', s.position, 'kind', s.kind,
           'heading', s.heading, 'body', s.body) order by s.doc_kind, s.position), '[]'::jsonb)
    into v_sections from public.agreement_template_sections s where s.template_id = _template_id;

  -- Units: unit lines on the selected invoices + invoices of the selected jobs (expanded per quantity, max 20 each);
  -- jobs without unit lines add one row; no source selected = the client's equipment register.
  with src_inv as (
    select i.id, i.invoice_number, i.issue_date, i.paid_date, null::uuid as job_id from public.invoices i where i.id = any(v_inv_ids)
    union
    select i.id, i.invoice_number, i.issue_date, i.paid_date, j.id from public.jobs j
      join public.invoices i on i.id = j.invoice_id or (j.quote_id is not null and i.quote_id = j.quote_id)
     where j.id = any(v_job_ids) and i.customer_id = _customer_id
  ), inv as (
    select distinct on (id) * from src_inv order by id, job_id nulls last
  ), lines as (
    select it.*, inv.invoice_number, inv.issue_date, inv.paid_date, inv.id as inv_id,
      (select max(j2.completed_at) from public.jobs j2 where j2.customer_id = _customer_id
         and (j2.invoice_id = inv.id or j2.id = any(v_job_ids))) as done_at,
      sp.brand, sp.model, sp.unit_type, coalesce(sp.capacity_btu, sp.btu_rating) as btu,
      concat_ws(' ', it.line_name, it.description) as txt
    from public.invoice_items it join inv on inv.id = it.invoice_id
    left join public.supplier_products sp on sp.id = it.product_id
    where it.line_type = 'unit'
  ), rows as (
    select l.*, g.n from lines l cross join lateral generate_series(1, greatest(1, least(20, ceil(coalesce(l.quantity, 1))::int))) g(n)
  )
  select coalesce(jsonb_agg(u order by ord), '[]'::jsonb) into v_units from (
    select row_number() over (order by r.invoice_number, r.sort_order nulls last, r.created_at, r.n) as ord,
      jsonb_strip_nulls(jsonb_build_object(
        'location', nullif(trim(coalesce(r.room_label, '')), ''),
        'type', coalesce(nullif(trim(coalesce(r.unit_type, '')), ''),
          case when r.txt ~* 'cassette' then 'Cassette' when r.txt ~* 'duct|hide ?away' then 'Ducted'
               when r.txt ~* 'under ?ceiling|floor' then 'Floor / underceiling' when r.txt ~* 'wall' then 'Wall split' end),
        'model', nullif(trim(concat_ws(' ', r.brand, coalesce(r.model, r.line_name))), ''),
        'size', case when r.btu is not null then r.btu::text
          when r.txt ~* '(\d{1,2})\s*k\s*btu' then ((regexp_match(r.txt, '(\d{1,2})\s*k\s*btu', 'i'))[1]::int * 1000)::text
          when r.txt ~* '(\d{4,6})\s*btu' then (regexp_match(r.txt, '(\d{4,6})\s*btu', 'i'))[1] end,
        'installDate', to_char(coalesce(r.done_at::date, r.paid_date::date, r.issue_date::date), 'DD Mon YYYY'),
        'byUs', 'Y',
        'ref', r.invoice_number)) as u
    from rows r
  ) x;

  if jsonb_array_length(v_units) = 0 and coalesce(array_length(v_job_ids, 1), 0) > 0 then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('location', nullif(j.title, ''), 'ref', 'Job ' || left(j.id::text, 8),
             'installDate', to_char(j.completed_at, 'DD Mon YYYY'))) order by j.created_at), '[]'::jsonb)
      into v_units from public.jobs j where j.id = any(v_job_ids);
  end if;
  if jsonb_array_length(v_units) = 0 and coalesce(array_length(v_inv_ids, 1), 0) = 0 and coalesce(array_length(v_job_ids, 1), 0) = 0 then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('location', nullif(e.location, ''), 'type', nullif(e.type, ''),
             'model', nullif(trim(concat_ws(' ', e.brand, e.model)), ''), 'serial', nullif(e.serial_number, ''),
             'installDate', to_char(e.install_date, 'DD Mon YYYY'))) order by e.created_at), '[]'::jsonb)
      into v_units from public.equipment e where e.customer_id = _customer_id;
  end if;

  select string_agg(distinct a, ' | ') into v_sites from (
    select trim(concat_ws(': ', nullif(l.label, ''), l.address)) a from public.customer_locations l where l.customer_id = _customer_id and coalesce(l.address, '') <> ''
    union select j.address from public.jobs j where j.id = any(v_job_ids) and coalesce(j.address, '') <> ''
    union select i.customer_address from public.invoices i where i.id = any(v_inv_ids) and coalesce(i.customer_address, '') <> ''
  ) s;

  v_vat := nullif(trim(coalesce(v_cust.vat_number, (select max(i.billed_to_vat_number) from public.invoices i where i.id = any(v_inv_ids)), '')), '');
  v_client := jsonb_strip_nulls(jsonb_build_object(
    'name', coalesce(nullif(trim(case when v_cust.is_company then v_cust.company_name end), ''), v_cust.name),
    'legalName', nullif(trim(coalesce(v_cust.company_name, '')), ''),
    'vat', v_vat,
    'postalAddress', nullif(trim(coalesce(nullif(concat_ws(', ', nullif(v_cust.primary_address_line1, ''), nullif(v_cust.primary_address_line2, ''), nullif(v_cust.city, ''), nullif(v_cust.postal_code, '')), ''), v_cust.address, '')), ''),
    'siteAddress', coalesce(v_sites, nullif(v_cust.address, '')),
    'contact', nullif(trim(concat_ws(' ', v_cust.first_name, v_cust.last_name)), ''),
    'phone', nullif(v_cust.phone, ''),
    'email', nullif(v_cust.email, '')));

  perform pg_advisory_xact_lock(hashtext('agreement_contract_no:' || v_company::text));
  select coalesce(max((regexp_match(contract_number, '^SC-\d{4}-(\d+)$'))[1]::int), 0) + 1 into v_seq
    from public.agreement_contracts where company_id = v_company and contract_number like 'SC-' || to_char(current_date, 'YYYY') || '-%';
  v_number := 'SC-' || to_char(current_date, 'YYYY') || '-' || lpad(v_seq::text, 3, '0');

  insert into public.agreement_contracts (company_id, customer_id, template_id, template_version, template_name, contract_number,
    start_date, frequency, client_snapshot, units, sections, source_invoice_ids, source_job_ids, service_agreement_id, created_by, updated_by)
  values (v_company, _customer_id, _template_id, v_tpl.version, v_tpl.name, v_number,
    coalesce(_start_date, current_date), coalesce(nullif(_frequency, ''), 'annual'), v_client, v_units, v_sections,
    v_inv_ids, v_job_ids, _service_agreement_id, v_uid, v_uid)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_agreement_contract(uuid, uuid, uuid[], uuid[], date, text, uuid) from public, anon;
grant execute on function public.create_agreement_contract(uuid, uuid, uuid[], uuid[], date, text, uuid) to authenticated;
