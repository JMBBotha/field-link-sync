-- Agreements > Templates (Johan 18 Oct 2026 20:05).
-- Editable service contract + SLA templates owned by the MAIN company (Massair CT).
-- Main-company admins create/edit; main-company staff (not techs) read all; approved
-- downline companies read ACTIVE templates only (drafts never leave the main company);
-- technicians get nothing. Every save keeps the previous content as a numbered version.
-- service_agreements gets an optional template link only: no trigger, no job/reminder change.

create table if not exists public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  tier text,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  version integer not null default 1,
  contract_pdf_path text,
  contract_docx_path text,
  sla_docx_path text,
  sla_pdf_path text,
  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agreement_template_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.agreement_templates(id) on delete cascade,
  doc_kind text not null check (doc_kind in ('contract','sla')),
  position integer not null,
  kind text not null default 'text' check (kind in ('text','signatures','units')),
  heading text not null default '',
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists agreement_template_sections_tpl_idx on public.agreement_template_sections(template_id, doc_kind, position);

create table if not exists public.agreement_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.agreement_templates(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

-- Access helpers -------------------------------------------------------------
create or replace function public.can_manage_agreement_templates(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null and public.can_write_master_catalog(_uid)
$$;

create or replace function public.can_read_agreement_template(_uid uuid, _company uuid, _status text)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid is not null
    and not public.is_field_tech_only(_uid)
    and _company = public.fl_master_company_id()
    and (
      public.is_master_company_user(_uid)
      or (public.is_approved_network_member(_uid) and _status = 'active')
    )
$$;

create or replace function public.can_read_agreement_template_id(_uid uuid, _template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agreement_templates t
    where t.id = _template_id and public.can_read_agreement_template(_uid, t.company_id, t.status)
  )
$$;

-- Storage path: <company_id>/templates/<template_id>/<file>
create or replace function public.can_read_agreement_doc(_uid uuid, _name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when split_part(_name, '/', 2) = 'templates'
         and split_part(_name, '/', 3) ~ '^[0-9a-f-]{36}$'
      then public.can_read_agreement_template_id(_uid, split_part(_name, '/', 3)::uuid)
    else false end
$$;

revoke all on function public.can_manage_agreement_templates(uuid) from public, anon;
revoke all on function public.can_read_agreement_template(uuid, uuid, text) from public, anon;
revoke all on function public.can_read_agreement_template_id(uuid, uuid) from public, anon;
revoke all on function public.can_read_agreement_doc(uuid, text) from public, anon;
grant execute on function public.can_manage_agreement_templates(uuid) to authenticated;
grant execute on function public.can_read_agreement_template(uuid, uuid, text) to authenticated;
grant execute on function public.can_read_agreement_template_id(uuid, uuid) to authenticated;
grant execute on function public.can_read_agreement_doc(uuid, text) to authenticated;

-- RLS ------------------------------------------------------------------------
alter table public.agreement_templates enable row level security;
alter table public.agreement_template_sections enable row level security;
alter table public.agreement_template_versions enable row level security;

drop policy if exists agt_read on public.agreement_templates;
create policy agt_read on public.agreement_templates for select to authenticated
  using (public.can_read_agreement_template(auth.uid(), company_id, status));
drop policy if exists agt_insert on public.agreement_templates;
create policy agt_insert on public.agreement_templates for insert to authenticated
  with check (public.can_manage_agreement_templates(auth.uid()) and company_id = public.fl_master_company_id());
drop policy if exists agt_update on public.agreement_templates;
create policy agt_update on public.agreement_templates for update to authenticated
  using (public.can_manage_agreement_templates(auth.uid()) and company_id = public.fl_master_company_id())
  with check (public.can_manage_agreement_templates(auth.uid()) and company_id = public.fl_master_company_id());
drop policy if exists agt_delete on public.agreement_templates;
create policy agt_delete on public.agreement_templates for delete to authenticated
  using (public.can_manage_agreement_templates(auth.uid()) and company_id = public.fl_master_company_id());

drop policy if exists agts_read on public.agreement_template_sections;
create policy agts_read on public.agreement_template_sections for select to authenticated
  using (public.can_read_agreement_template_id(auth.uid(), template_id));
drop policy if exists agts_write on public.agreement_template_sections;
create policy agts_write on public.agreement_template_sections for all to authenticated
  using (public.can_manage_agreement_templates(auth.uid()))
  with check (public.can_manage_agreement_templates(auth.uid()));

drop policy if exists agtv_read on public.agreement_template_versions;
create policy agtv_read on public.agreement_template_versions for select to authenticated
  using (public.can_read_agreement_template_id(auth.uid(), template_id));
drop policy if exists agtv_insert on public.agreement_template_versions;
create policy agtv_insert on public.agreement_template_versions for insert to authenticated
  with check (public.can_manage_agreement_templates(auth.uid()));
-- versions are history: no update/delete policy (kept forever).

revoke all on public.agreement_templates, public.agreement_template_sections, public.agreement_template_versions from anon;
grant select, insert, update, delete on public.agreement_templates, public.agreement_template_sections to authenticated;
grant select, insert on public.agreement_template_versions to authenticated;

-- Save = one transaction: meta + all sections replaced + version bumped + snapshot kept.
create or replace function public.save_agreement_template(
  _template_id uuid, _meta jsonb, _sections jsonb, _note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tpl public.agreement_templates%rowtype;
  v_new integer;
  v_snapshot jsonb;
begin
  if not public.can_manage_agreement_templates(v_uid) then
    raise exception 'Only main-company admins can edit agreement templates' using errcode = '42501';
  end if;
  select * into v_tpl from public.agreement_templates where id = _template_id for update;
  if not found or v_tpl.company_id <> public.fl_master_company_id() then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(_sections, '[]'::jsonb)) <> 'array' then
    raise exception 'sections must be an array';
  end if;

  update public.agreement_templates set
    name = coalesce(nullif(trim(_meta->>'name'), ''), name),
    tier = case when _meta ? 'tier' then nullif(trim(_meta->>'tier'), '') else tier end,
    description = case when _meta ? 'description' then _meta->>'description' else description end,
    status = case when _meta->>'status' in ('draft','active','archived') then _meta->>'status' else status end,
    version = version + 1,
    updated_by = v_uid,
    updated_at = now()
  where id = _template_id
  returning version into v_new;

  delete from public.agreement_template_sections where template_id = _template_id;
  insert into public.agreement_template_sections (template_id, doc_kind, position, kind, heading, body)
  select _template_id,
         s->>'doc_kind',
         row_number() over (partition by s->>'doc_kind' order by coalesce((s->>'position')::int, ord::int), ord),
         coalesce(nullif(s->>'kind', ''), 'text'),
         coalesce(s->>'heading', ''),
         coalesce(s->>'body', '')
  from jsonb_array_elements(coalesce(_sections, '[]'::jsonb)) with ordinality as x(s, ord);

  select jsonb_build_object(
    'name', t.name, 'tier', t.tier, 'description', t.description, 'status', t.status,
    'sections', coalesce((select jsonb_agg(jsonb_build_object('doc_kind', s.doc_kind, 'position', s.position,
        'kind', s.kind, 'heading', s.heading, 'body', s.body) order by s.doc_kind, s.position)
      from public.agreement_template_sections s where s.template_id = t.id), '[]'::jsonb))
  into v_snapshot from public.agreement_templates t where t.id = _template_id;

  insert into public.agreement_template_versions (template_id, version, snapshot, note, created_by)
  values (_template_id, v_new, v_snapshot, nullif(trim(coalesce(_note, '')), ''), v_uid);
  return v_new;
end $$;
revoke all on function public.save_agreement_template(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_agreement_template(uuid, jsonb, jsonb, text) to authenticated;

-- Optional link from a client's agreement to a template (display only).
alter table public.service_agreements
  add column if not exists template_id uuid references public.agreement_templates(id) on delete set null,
  add column if not exists template_version integer,
  add column if not exists attached_file_path text;

-- Private bucket for the original files.
insert into storage.buckets (id, name, public) values ('agreement-docs', 'agreement-docs', false)
on conflict (id) do nothing;

drop policy if exists agreement_docs_read on storage.objects;
create policy agreement_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'agreement-docs' and public.can_read_agreement_doc(auth.uid(), name));
drop policy if exists agreement_docs_insert on storage.objects;
create policy agreement_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'agreement-docs' and public.can_manage_agreement_templates(auth.uid())
    and split_part(name, '/', 1) = public.fl_master_company_id()::text);
drop policy if exists agreement_docs_update on storage.objects;
create policy agreement_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'agreement-docs' and public.can_manage_agreement_templates(auth.uid())
    and split_part(name, '/', 1) = public.fl_master_company_id()::text);
drop policy if exists agreement_docs_delete on storage.objects;
create policy agreement_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'agreement-docs' and public.can_manage_agreement_templates(auth.uid())
    and split_part(name, '/', 1) = public.fl_master_company_id()::text);
