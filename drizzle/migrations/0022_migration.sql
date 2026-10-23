create table public.unit_mockups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  model_key text not null,
  label text,
  image_url text not null,
  storage_path text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, model_key)
);
alter table public.unit_mockups enable row level security;
grant select, insert, update, delete on public.unit_mockups to authenticated;
create policy "unit_mockups company read" on public.unit_mockups for select to authenticated using (company_id = public.caller_company_id());
create policy "unit_mockups company insert" on public.unit_mockups for insert to authenticated with check (company_id = public.caller_company_id());
create policy "unit_mockups company update" on public.unit_mockups for update to authenticated using (company_id = public.caller_company_id()) with check (company_id = public.caller_company_id());
create policy "unit_mockups company delete" on public.unit_mockups for delete to authenticated using (company_id = public.caller_company_id());
create policy "product-media mockups company write" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-media' and (storage.foldername(name))[1] = 'mockups' and (storage.foldername(name))[2] = public.caller_company_id()::text);
create policy "product-media mockups company update" on storage.objects for update to authenticated
  using (bucket_id = 'product-media' and (storage.foldername(name))[1] = 'mockups' and (storage.foldername(name))[2] = public.caller_company_id()::text);