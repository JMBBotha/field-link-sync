-- Rollback for inheritance release 2026-10-13 (repo HEAD before: b9c4eec). Code rollback: git revert <commit>.
begin;
drop trigger if exists aa_fl_inherit_pricing on public.companies;
drop trigger if exists zz_fl_companies_after on public.companies;
drop trigger if exists aa_fl_settings_inherit on public.company_settings;
drop trigger if exists zz_fl_settings_after on public.company_settings;
drop trigger if exists aa_fl_profiles_terms on public.company_profiles;
drop trigger if exists zz_fl_profiles_after on public.company_profiles;
-- restore original guard (definition saved in backup_inherit_20261013.guard_fn)
create or replace function public.guard_company_tech_pay_settings() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
BEGIN
  IF (NEW.tech_paid_on_completion_pct IS DISTINCT FROM OLD.tech_paid_on_completion_pct
      OR NEW.tech_holdback_pct IS DISTINCT FROM OLD.tech_holdback_pct
      OR NEW.tech_holdback_days IS DISTINCT FROM OLD.tech_holdback_days
      OR NEW.tools_retained_pct IS DISTINCT FROM OLD.tools_retained_pct)
     AND auth.uid() IS NOT NULL AND NOT public.is_company_admin(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Only a company admin or the owner can change tech pay settings';
  END IF;
  RETURN NEW;
END $function$;
-- restore values
update public.companies c set default_rate=b.default_rate, labour_cost_per_hour=b.labour_cost_per_hour, units_markup_percent=b.units_markup_percent,
  materials_markup_percent=b.materials_markup_percent, materials_waste_percent=b.materials_waste_percent, gp_target_percent=b.gp_target_percent,
  sales_commission_percent=b.sales_commission_percent, labour_tech_share_percent=b.labour_tech_share_percent, tech_split_mode=b.tech_split_mode,
  tech_paid_on_completion_pct=b.tech_paid_on_completion_pct, tech_holdback_pct=b.tech_holdback_pct, tech_holdback_days=b.tech_holdback_days,
  tools_retained_pct=b.tools_retained_pct from backup_inherit_20261013.companies b where b.id=c.id;
update public.company_settings c set default_hourly_rate=b.default_hourly_rate, default_deposit_percentage=b.default_deposit_percentage,
  default_payment_terms_days=b.default_payment_terms_days, default_install_labour_hours=b.default_install_labour_hours
  from backup_inherit_20261013.company_settings b where b.id=c.id;
update public.company_profiles c set terms_text=b.terms_text from backup_inherit_20261013.company_profiles b where b.id=c.id;
delete from public.company_network_members where id not in (select id from backup_inherit_20261013.company_network_members);
drop function if exists public.fl_companies_inherit_pricing(), public.fl_companies_after(), public.fl_settings_inherit(), public.fl_settings_after(),
  public.fl_profiles_inherit_terms(), public.fl_profiles_after(), public.fl_inherited_terms(public.company_profiles);
-- policies
drop policy if exists "fl_main_admins_insert_notif" on public.notification_settings;
drop policy if exists "fl_main_admins_update_notif" on public.notification_settings;
drop policy if exists "fl_main_admins_delete_notif" on public.notification_settings;
create policy "Admins can create notification settings" on public.notification_settings for insert with check (has_role(auth.uid(),'admin'));
create policy "Admins can update notification settings" on public.notification_settings for update using (has_role(auth.uid(),'admin'));
create policy "Admins can delete notification settings" on public.notification_settings for delete using (has_role(auth.uid(),'admin'));
drop policy if exists "fl_main_write_qt_ins" on public.quote_templates; drop policy if exists "fl_main_write_qt_upd" on public.quote_templates; drop policy if exists "fl_main_write_qt_del" on public.quote_templates;
create policy "Admins can insert templates" on public.quote_templates for insert with check (has_role(auth.uid(),'admin'));
create policy "Admins can update templates" on public.quote_templates for update using (has_role(auth.uid(),'admin'));
create policy "Admins can delete templates" on public.quote_templates for delete using (has_role(auth.uid(),'admin'));
drop policy if exists "fl_main_write_qti_ins" on public.quote_template_items; drop policy if exists "fl_main_write_qti_upd" on public.quote_template_items; drop policy if exists "fl_main_write_qti_del" on public.quote_template_items;
create policy "Admins can insert template items" on public.quote_template_items for insert with check (has_role(auth.uid(),'admin'));
create policy "Admins can update template items" on public.quote_template_items for update using (has_role(auth.uid(),'admin'));
create policy "Admins can delete template items" on public.quote_template_items for delete using (has_role(auth.uid(),'admin'));
drop policy if exists "fl_main_write_pt_ins" on public.proposal_templates; drop policy if exists "fl_main_write_pt_upd" on public.proposal_templates; drop policy if exists "fl_main_write_pt_del" on public.proposal_templates;
create policy "Admins can manage proposal templates" on public.proposal_templates for insert with check (has_role(auth.uid(),'admin'));
create policy "Admins can update proposal templates" on public.proposal_templates for update using (has_role(auth.uid(),'admin'));
create policy "Admins can delete proposal templates" on public.proposal_templates for delete using (has_role(auth.uid(),'admin'));
drop policy if exists "fl_main_manage_install_templates" on public.install_templates;
create policy "Admins manage install templates" on public.install_templates for all to authenticated using (has_role(auth.uid(),'admin')) with check (has_role(auth.uid(),'admin'));
drop policy if exists "fl_main_insert_invoice_templates" on public.invoice_templates; drop policy if exists "fl_read_main_invoice_templates" on public.invoice_templates;
create policy "Company users can insert own templates" on public.invoice_templates for insert to authenticated with check ((created_by = auth.uid()) AND (caller_company_id() IS NOT NULL));
drop policy if exists "fl_vpt_select_own" on public.visual_proposal_templates; drop policy if exists "fl_vpt_select_main" on public.visual_proposal_templates; drop policy if exists "fl_vpt_main_write" on public.visual_proposal_templates;
create policy "Tenant users can create visual proposal templates" on public.visual_proposal_templates for insert to authenticated with check (company_id = get_user_company_id(auth.uid()));
create policy "Tenant users can update visual proposal templates" on public.visual_proposal_templates for update to authenticated using (company_id = get_user_company_id(auth.uid())) with check (company_id = get_user_company_id(auth.uid()));
create policy "Tenant admins can delete visual proposal templates" on public.visual_proposal_templates for delete to authenticated using ((company_id = get_user_company_id(auth.uid())) AND has_role(auth.uid(),'admin'));
create policy "p4_company_scope" on public.visual_proposal_templates for all to authenticated using (p4_co_ok(company_id) OR (created_by = auth.uid())) with check (p4_co_ok(company_id));
drop function if exists public.fl_inherit_sync_on(), public.fl_master_company_id();
commit;
