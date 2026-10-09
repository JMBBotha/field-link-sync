-- P5 0800-BE-COOL (Field Lynk) becomes the master company; AB Refrigeration = isolated sandbox network member (2026-10-09)
-- backups (idempotent)
CREATE TABLE IF NOT EXISTS backup_p4_20261009.p5_companies AS SELECT * FROM public.companies;
CREATE TABLE IF NOT EXISTS backup_p4_20261009.p5_profiles AS SELECT * FROM public.profiles WHERE id IN ('1e795a9b-f8bd-4af5-8f28-5e0426101daa','09a7f5af-2752-4835-8738-54f7b53083ea');
CREATE TABLE IF NOT EXISTS backup_p4_20261009.p5_user_roles AS SELECT * FROM public.user_roles WHERE user_id IN ('1e795a9b-f8bd-4af5-8f28-5e0426101daa','09a7f5af-2752-4835-8738-54f7b53083ea');
CREATE TABLE IF NOT EXISTS backup_p4_20261009.p5_null_quotes AS SELECT id FROM public.quotes WHERE company_id IS NULL;

-- 1) the one company-less draft quote belongs to AB (removes every "oldest master" fallback)
UPDATE public.quotes SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;

-- 2) new master company (commercial defaults copied from AB; editable in Settings)
INSERT INTO public.companies (id, name, slug, is_master, status, onboarding_completed, services, default_rate, labour_cost_per_hour, vat_rate,
  materials_markup_percent, materials_waste_percent, units_markup_percent, gp_target_percent, labour_tech_share_percent, sales_commission_percent,
  tech_split_mode, tech_paid_on_completion_pct, tech_holdback_pct, tech_holdback_days, tools_retained_pct, work_days, work_start, work_end, custom_service_limit, install_handoff_default)
SELECT '361bf031-9cdb-4d7f-9bde-9eb95fa4725e', '0800-BE-COOL (Field Lynk)', '0800-be-cool', true, 'active', true, services, default_rate, labour_cost_per_hour, vat_rate,
  materials_markup_percent, materials_waste_percent, units_markup_percent, gp_target_percent, labour_tech_share_percent, sales_commission_percent,
  tech_split_mode, tech_paid_on_completion_pct, tech_holdback_pct, tech_holdback_days, tools_retained_pct, work_days, work_start, work_end, custom_service_limit, 'manual'
FROM public.companies WHERE id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd'
ON CONFLICT (id) DO NOTHING;
UPDATE public.companies SET is_master = false WHERE id <> '361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND is_master;

-- 3) main account = owner/admin, Innocent = staff technician (no AB link)
UPDATE public.profiles SET company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e' WHERE id = '1e795a9b-f8bd-4af5-8f28-5e0426101daa';
UPDATE public.profiles SET company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e', participant_type = 'company_staff', dispatch_role = 'technician'
 WHERE id = '09a7f5af-2752-4835-8738-54f7b53083ea';
INSERT INTO public.company_members (user_id, company_id, role, is_owner) SELECT '1e795a9b-f8bd-4af5-8f28-5e0426101daa','361bf031-9cdb-4d7f-9bde-9eb95fa4725e','admin',true
 WHERE NOT EXISTS (SELECT 1 FROM public.company_members WHERE user_id='1e795a9b-f8bd-4af5-8f28-5e0426101daa' AND company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e');
INSERT INTO public.company_members (user_id, company_id, role, is_owner) SELECT '09a7f5af-2752-4835-8738-54f7b53083ea','361bf031-9cdb-4d7f-9bde-9eb95fa4725e','member',false
 WHERE NOT EXISTS (SELECT 1 FROM public.company_members WHERE user_id='09a7f5af-2752-4835-8738-54f7b53083ea' AND company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e');
INSERT INTO public.user_roles (user_id, role) VALUES ('1e795a9b-f8bd-4af5-8f28-5e0426101daa','admin') ON CONFLICT (user_id, role) DO NOTHING;

-- 4) network: AB + Test HVAC approved members -> read-only master catalogue (no data shared)
INSERT INTO public.company_network_members (master_company_id, member_company_id, status, decided_at, decided_by)
SELECT '361bf031-9cdb-4d7f-9bde-9eb95fa4725e', c.id, 'approved', now(), '1e795a9b-f8bd-4af5-8f28-5e0426101daa'
FROM public.companies c WHERE c.id IN ('d9b494c7-cdb2-4e86-b4e9-8860c3519dbd','4ddd72cb-56b9-448a-a589-3490bbc464ae')
  AND NOT EXISTS (SELECT 1 FROM public.company_network_members m WHERE m.master_company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND m.member_company_id=c.id);

-- 5) company settings: every company manages its own row (was master-only)
DROP POLICY IF EXISTS p5_cs_select ON public.company_settings;
CREATE POLICY p5_cs_select ON public.company_settings FOR SELECT TO authenticated USING (company_id IS NOT NULL AND public.p4_co_ok(company_id));
DROP POLICY IF EXISTS p5_cs_insert ON public.company_settings;
CREATE POLICY p5_cs_insert ON public.company_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) AND company_id IS NOT NULL AND public.p4_co_ok(company_id));
DROP POLICY IF EXISTS p5_cs_update ON public.company_settings;
CREATE POLICY p5_cs_update ON public.company_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role) AND public.p4_co_ok(company_id)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) AND company_id IS NOT NULL AND public.p4_co_ok(company_id));

-- 6) public quote page: use the quote's own company row; AB keeps exactly the row it shows today (72a8a391)
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_public_quote(uuid)'::regprocedure);
  IF position('/*p5cs*/' in d) = 0 THEN
    IF position('INTO v_quote' in d) = 0 OR position('INTO v_quote' in d) > position('INTO v_settings' in d) THEN RAISE EXCEPTION 'p5: unexpected get_public_quote shape'; END IF;
    d := replace(d, 'SELECT * INTO v_settings FROM public.company_settings LIMIT 1;',
      'SELECT * INTO v_settings FROM public.company_settings ORDER BY (company_id IS NOT DISTINCT FROM v_quote.company_id) DESC, (id = ''72a8a391-b7d6-428f-9f2a-9bf281907648'') DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/');
    IF position('/*p5cs*/' in d) = 0 THEN RAISE EXCEPTION 'p5: settings reader pattern not found'; END IF;
    EXECUTE d;
  END IF;
END $$;
-- P5b: profiles visible only within your company (+ unaffiliated independents, + techs affiliated to your company); Innocent's sandbox affiliation with AB deactivated
CREATE TABLE IF NOT EXISTS backup_p4_20261009.p5_affiliations AS SELECT * FROM public.agent_affiliations;
UPDATE public.agent_affiliations SET status = 'inactive'
 WHERE profile_id = '09a7f5af-2752-4835-8738-54f7b53083ea' AND company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' AND status = 'active';
CREATE OR REPLACE FUNCTION public.p5_profile_visible(_p uuid, _co uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _p = auth.uid() OR _co IS NULL OR public.p4_co_ok(_co)
    OR EXISTS (SELECT 1 FROM public.agent_affiliations a WHERE a.profile_id = _p AND a.status = 'active' AND public.p4_co_ok(a.company_id)) $$;
DROP POLICY IF EXISTS p5_profiles_scope ON public.profiles;
CREATE POLICY p5_profiles_scope ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated USING (public.p5_profile_visible(id, company_id));
