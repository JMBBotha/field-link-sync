-- Inheritance from main company (Johan approved 2026-10-13 12:25). Additive; rollback.sql reverses.
begin;

create or replace function public.fl_master_company_id() returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from public.companies where is_master order by created_at limit 1 $$;

create or replace function public.fl_inherit_sync_on() returns boolean
language sql stable as $$ select coalesce(current_setting('fl.inherit_sync', true),'') = 'on' $$;

-- Tech pay guard: allow the main company's automatic propagation
create or replace function public.guard_company_tech_pay_settings() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
BEGIN
  IF public.fl_inherit_sync_on() THEN RETURN NEW; END IF;
  IF (NEW.tech_paid_on_completion_pct IS DISTINCT FROM OLD.tech_paid_on_completion_pct
      OR NEW.tech_holdback_pct IS DISTINCT FROM OLD.tech_holdback_pct
      OR NEW.tech_holdback_days IS DISTINCT FROM OLD.tech_holdback_days
      OR NEW.tools_retained_pct IS DISTINCT FROM OLD.tools_retained_pct)
     AND auth.uid() IS NOT NULL AND NOT public.is_company_admin(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Only a company admin or the owner can change tech pay settings';
  END IF;
  RETURN NEW;
END $function$;

-- 5) Pricing on companies: always the main company's values
create or replace function public.fl_companies_inherit_pricing() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare m public.companies%rowtype;
begin
  if NEW.is_master then return NEW; end if;
  select * into m from public.companies where is_master and id <> NEW.id order by created_at limit 1;
  if m.id is null then return NEW; end if;
  NEW.default_rate := m.default_rate; NEW.labour_cost_per_hour := m.labour_cost_per_hour;
  NEW.units_markup_percent := m.units_markup_percent; NEW.materials_markup_percent := m.materials_markup_percent;
  NEW.materials_waste_percent := m.materials_waste_percent; NEW.gp_target_percent := m.gp_target_percent;
  NEW.sales_commission_percent := m.sales_commission_percent; NEW.labour_tech_share_percent := m.labour_tech_share_percent;
  NEW.tech_split_mode := m.tech_split_mode; NEW.tech_paid_on_completion_pct := m.tech_paid_on_completion_pct;
  NEW.tech_holdback_pct := m.tech_holdback_pct; NEW.tech_holdback_days := m.tech_holdback_days;
  NEW.tools_retained_pct := m.tools_retained_pct;
  return NEW;
end $$;
drop trigger if exists aa_fl_inherit_pricing on public.companies;
create trigger aa_fl_inherit_pricing before insert or update on public.companies
  for each row execute function public.fl_companies_inherit_pricing();

create or replace function public.fl_companies_after() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if TG_OP = 'INSERT' and not NEW.is_master then
    -- 1) new companies auto-join the main catalogue network (read-only)
    insert into public.company_network_members (master_company_id, member_company_id, status, decided_at)
    select public.fl_master_company_id(), NEW.id, 'approved', now()
    where public.fl_master_company_id() is not null
      and not exists (select 1 from public.company_network_members x where x.member_company_id = NEW.id);
  elsif TG_OP = 'UPDATE' and NEW.is_master then
    perform set_config('fl.inherit_sync','on',true);
    update public.companies set updated_at = updated_at where not is_master;
    perform set_config('fl.inherit_sync','off',true);
  end if;
  return null;
end $$;
drop trigger if exists zz_fl_companies_after on public.companies;
create trigger zz_fl_companies_after after insert or update on public.companies
  for each row execute function public.fl_companies_after();

-- 5) company_settings deposit / payment terms / default hours / rate from main
create or replace function public.fl_settings_inherit() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare m public.company_settings%rowtype; mc uuid := public.fl_master_company_id();
begin
  if mc is null or NEW.company_id = mc then return NEW; end if;
  select * into m from public.company_settings where company_id = mc order by is_primary desc, created_at limit 1;
  if m.id is null then return NEW; end if;
  NEW.default_hourly_rate := m.default_hourly_rate; NEW.default_deposit_percentage := m.default_deposit_percentage;
  NEW.default_payment_terms_days := m.default_payment_terms_days; NEW.default_install_labour_hours := m.default_install_labour_hours;
  return NEW;
end $$;
drop trigger if exists aa_fl_settings_inherit on public.company_settings;
create trigger aa_fl_settings_inherit before insert or update on public.company_settings
  for each row execute function public.fl_settings_inherit();

create or replace function public.fl_settings_after() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.company_id = public.fl_master_company_id() then
    update public.company_settings set updated_at = updated_at where company_id is distinct from NEW.company_id and company_id is not null;
  end if;
  return null;
end $$;
drop trigger if exists zz_fl_settings_after on public.company_settings;
create trigger zz_fl_settings_after after insert or update on public.company_settings
  for each row execute function public.fl_settings_after();

-- 6) Terms: main text, own legal name, own banking block
create or replace function public.fl_inherited_terms(_p public.company_profiles) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare m public.company_profiles%rowtype; t text; bank text := ''; esc text;
begin
  select * into m from public.company_profiles
   where company_id = public.fl_master_company_id() and archived_at is null
   order by is_default desc, created_at limit 1;
  if m.id is null or m.terms_text is null then return _p.terms_text; end if;
  t := m.terms_text;
  if coalesce(btrim(_p.account_number),'') <> '' then
    bank := 'BANKING DETAILS:' || E'\n'
      || 'Account Name: ' || coalesce(_p.account_name, _p.legal_name) || E'\n'
      || 'Bank: ' || coalesce(_p.bank_name,'') || E'\n'
      || 'Account Type: ' || coalesce(_p.account_type,'') || E'\n'
      || 'Account Number: ' || _p.account_number || E'\n'
      || 'Branch Code: ' || coalesce(_p.branch_code,'');
  end if;
  -- never carry the main company's bank account into another company's terms
  t := regexp_replace(t, 'BANKING DETAILS:.*?(\n[ \t]*\n(?=[A-Z][A-Z ]+:)|$)', case when bank = '' then '' else bank || E'\n\n' end, 'i');
  esc := regexp_replace(m.legal_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
  t := regexp_replace(t, esc, coalesce(nullif(btrim(_p.legal_name),''), m.legal_name), 'gi');
  return btrim(t);
end $$;

create or replace function public.fl_profiles_inherit_terms() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.company_id is distinct from public.fl_master_company_id() then
    NEW.terms_text := public.fl_inherited_terms(NEW);
  end if;
  return NEW;
end $$;
drop trigger if exists aa_fl_profiles_terms on public.company_profiles;
create trigger aa_fl_profiles_terms before insert or update on public.company_profiles
  for each row execute function public.fl_profiles_inherit_terms();

create or replace function public.fl_profiles_after() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.company_id = public.fl_master_company_id() then
    update public.company_profiles set updated_at = updated_at where company_id is distinct from NEW.company_id;
  end if;
  return null;
end $$;
drop trigger if exists zz_fl_profiles_after on public.company_profiles;
create trigger zz_fl_profiles_after after update of terms_text, legal_name on public.company_profiles
  for each row execute function public.fl_profiles_after();

-- 3) Notification settings: only main-company admins change them
drop policy "Admins can create notification settings" on public.notification_settings;
drop policy "Admins can update notification settings" on public.notification_settings;
drop policy "Admins can delete notification settings" on public.notification_settings;
create policy "fl_main_admins_insert_notif" on public.notification_settings for insert to authenticated
  with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_admins_update_notif" on public.notification_settings for update to authenticated
  using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()))
  with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_admins_delete_notif" on public.notification_settings for delete to authenticated
  using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));

-- 4) Templates: authored only by main admins, readable by all
drop policy "Admins can insert templates" on public.quote_templates;
drop policy "Admins can update templates" on public.quote_templates;
drop policy "Admins can delete templates" on public.quote_templates;
create policy "fl_main_write_qt_ins" on public.quote_templates for insert to authenticated with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_write_qt_upd" on public.quote_templates for update to authenticated using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid())) with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_write_qt_del" on public.quote_templates for delete to authenticated using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));

drop policy "Admins can insert template items" on public.quote_template_items;
drop policy "Admins can update template items" on public.quote_template_items;
drop policy "Admins can delete template items" on public.quote_template_items;
create policy "fl_main_write_qti_ins" on public.quote_template_items for insert to authenticated with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_write_qti_upd" on public.quote_template_items for update to authenticated using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid())) with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_write_qti_del" on public.quote_template_items for delete to authenticated using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));

drop policy "Admins can manage proposal templates" on public.proposal_templates;
drop policy "Admins can update proposal templates" on public.proposal_templates;
drop policy "Admins can delete proposal templates" on public.proposal_templates;
create policy "fl_main_write_pt_ins" on public.proposal_templates for insert to authenticated with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_write_pt_upd" on public.proposal_templates for update to authenticated using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid())) with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_main_write_pt_del" on public.proposal_templates for delete to authenticated using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));

drop policy "Admins manage install templates" on public.install_templates;
create policy "fl_main_manage_install_templates" on public.install_templates for all to authenticated
  using (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()))
  with check (has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));

-- invoice templates: main authors; everyone reads main's
drop policy "Company users can insert own templates" on public.invoice_templates;
create policy "fl_main_insert_invoice_templates" on public.invoice_templates for insert to authenticated
  with check (created_by = auth.uid() and has_role(auth.uid(),'admin') and is_master_company_user(auth.uid()));
create policy "fl_read_main_invoice_templates" on public.invoice_templates for select to authenticated
  using (get_user_company_id(created_by) = public.fl_master_company_id() and not is_field_tech_only(auth.uid()));

-- visual proposal templates: main authors; everyone reads main's
drop policy "Tenant users can create visual proposal templates" on public.visual_proposal_templates;
drop policy "Tenant users can update visual proposal templates" on public.visual_proposal_templates;
drop policy "Tenant admins can delete visual proposal templates" on public.visual_proposal_templates;
drop policy "p4_company_scope" on public.visual_proposal_templates;
create policy "fl_vpt_select_own" on public.visual_proposal_templates for select to authenticated
  using (p4_co_ok(company_id) or created_by = auth.uid());
create policy "fl_vpt_select_main" on public.visual_proposal_templates for select to authenticated
  using (company_id = public.fl_master_company_id());
create policy "fl_vpt_main_write" on public.visual_proposal_templates for all to authenticated
  using (company_id = public.fl_master_company_id() and is_master_company_user(auth.uid()))
  with check (company_id = public.fl_master_company_id() and is_master_company_user(auth.uid()));

-- Backfill existing companies (pricing, settings, terms) and network rows
select set_config('fl.inherit_sync','on',true);
update public.companies set updated_at = updated_at where not is_master;
select set_config('fl.inherit_sync','off',true);
update public.company_settings set updated_at = updated_at where company_id is distinct from public.fl_master_company_id();
update public.company_profiles set updated_at = updated_at where company_id is distinct from public.fl_master_company_id();
insert into public.company_network_members (master_company_id, member_company_id, status, decided_at)
select public.fl_master_company_id(), c.id, 'approved', now() from public.companies c
where not c.is_master and not exists (select 1 from public.company_network_members x where x.member_company_id = c.id);

commit;
