begin;
create table if not exists public.client_sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.customers(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  address text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists client_sites_client_idx on public.client_sites(client_id);
create or replace function public.client_sites_sync_company() returns trigger language plpgsql security definer set search_path=public as $$
begin
  select company_id into new.company_id from public.customers where id = new.client_id;
  return new;
end $$;
drop trigger if exists trg_client_sites_company on public.client_sites;
create trigger trg_client_sites_company before insert or update on public.client_sites for each row execute function public.client_sites_sync_company();
alter table public.client_sites enable row level security;
drop policy if exists client_sites_select on public.client_sites;
drop policy if exists client_sites_insert on public.client_sites;
drop policy if exists client_sites_update on public.client_sites;
drop policy if exists client_sites_delete on public.client_sites;
create policy client_sites_select on public.client_sites for select to authenticated using (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
create policy client_sites_insert on public.client_sites for insert to authenticated with check (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
create policy client_sites_update on public.client_sites for update to authenticated using (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id)) with check (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
create policy client_sites_delete on public.client_sites for delete to authenticated using (company_id = get_user_company_id(auth.uid()) or p4_co_ok(company_id));
grant select, insert, update, delete on public.client_sites to authenticated;
insert into public.client_sites(client_id, name, address, notes)
select '3dde87f5-60cf-5cda-bc54-edd8b0e553cc', v.n, v.a, v.no
from (values ('Registered address','18 Main Road, Courtrai, Paarl, 7646',null::text),
             ('Avec','Avec La Terre Boulevard, Paarl',null),
             ('Stellenbosch Village',null,'Address TBD')) v(n,a,no)
where exists (select 1 from public.customers where id='3dde87f5-60cf-5cda-bc54-edd8b0e553cc' and company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e')
  and not exists (select 1 from public.client_sites s where s.client_id='3dde87f5-60cf-5cda-bc54-edd8b0e553cc' and s.name=v.n);
commit;
