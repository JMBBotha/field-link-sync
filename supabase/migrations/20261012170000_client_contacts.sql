create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.customers(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role text,
  notes text,
  is_primary boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_contacts_client_idx on public.client_contacts(client_id);
create unique index if not exists client_contacts_one_primary on public.client_contacts(client_id) where is_primary;
create or replace function public.client_contacts_sync_company() returns trigger language plpgsql security definer set search_path=public as $$
begin
  select company_id into new.company_id from public.customers where id = new.client_id;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_client_contacts_company on public.client_contacts;
create trigger trg_client_contacts_company before insert or update on public.client_contacts for each row execute function public.client_contacts_sync_company();
alter table public.client_contacts enable row level security;
drop policy if exists client_contacts_select on public.client_contacts;
drop policy if exists client_contacts_insert on public.client_contacts;
drop policy if exists client_contacts_update on public.client_contacts;
drop policy if exists client_contacts_delete on public.client_contacts;
create policy client_contacts_select on public.client_contacts for select to authenticated using (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
create policy client_contacts_insert on public.client_contacts for insert to authenticated with check (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
create policy client_contacts_update on public.client_contacts for update to authenticated using (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id)) with check (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
create policy client_contacts_delete on public.client_contacts for delete to authenticated using (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
grant select, insert, update, delete on public.client_contacts to authenticated;
-- migrate existing client contact as primary (additive)
insert into public.client_contacts(client_id, company_id, name, email, phone, is_primary, role)
select c.id, c.company_id, coalesce(nullif(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),''), c.name), nullif(c.email,''), nullif(c.phone,''), true, 'Primary'
from public.customers c
where not exists (select 1 from public.client_contacts x where x.client_id = c.id);
