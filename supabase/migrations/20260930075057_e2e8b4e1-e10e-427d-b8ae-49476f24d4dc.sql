-- R4 sign-up lockdown /*slk*/
-- 1. company_settings: AB (master company) is the only tenant. Read = master-company users, write = master-company admins.
DROP POLICY IF EXISTS "Authenticated users can view company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Admins can insert company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Admins can update company settings" ON public.company_settings;
DROP POLICY IF EXISTS "Admins can delete company settings" ON public.company_settings;
CREATE POLICY "Master company users can view company settings" ON public.company_settings
  FOR SELECT TO authenticated USING (public.is_master_company_user(auth.uid()));
CREATE POLICY "Master company admins can insert company settings" ON public.company_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()));
CREATE POLICY "Master company admins can update company settings" ON public.company_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()));
CREATE POLICY "Master company admins can delete company settings" ON public.company_settings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()));

-- 2. invoice_templates: creator's company can read; creator or that company's admins can write.
DROP POLICY IF EXISTS "Authenticated users can view templates" ON public.invoice_templates;
DROP POLICY IF EXISTS "Authenticated users can insert templates" ON public.invoice_templates;
DROP POLICY IF EXISTS "Authenticated users can update templates" ON public.invoice_templates;
DROP POLICY IF EXISTS "Authenticated users can delete templates" ON public.invoice_templates;
CREATE POLICY "Company members can view templates" ON public.invoice_templates
  FOR SELECT TO authenticated USING (created_by = auth.uid()
    OR (public.caller_company_id() IS NOT NULL AND public.get_user_company_id(created_by) = public.caller_company_id()));
CREATE POLICY "Company users can insert own templates" ON public.invoice_templates
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND public.caller_company_id() IS NOT NULL);
CREATE POLICY "Owner or company admins can update templates" ON public.invoice_templates
  FOR UPDATE TO authenticated USING (created_by = auth.uid()
    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.get_user_company_id(created_by) = public.caller_company_id()))
  WITH CHECK (created_by = auth.uid()
    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.get_user_company_id(created_by) = public.caller_company_id()));
CREATE POLICY "Owner or company admins can delete templates" ON public.invoice_templates
  FOR DELETE TO authenticated USING (created_by = auth.uid()
    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.get_user_company_id(created_by) = public.caller_company_id()));

-- 3. profiles: stop self-granting access.
-- Who may change access fields: platform super admin, or an admin/office user of the SAME company
-- (for independents with no company: master-company admin/office).
CREATE OR REPLACE FUNCTION public.can_manage_profile_access(_target_company uuid, _target_participant text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'platform_super_admin'::app_role)
    OR ((public.has_role(auth.uid(), 'admin'::app_role) OR public.is_office_staff(auth.uid())) AND (
         (_target_company IS NOT NULL AND _target_company = public.caller_company_id())
      OR (_target_company IS NULL AND _target_participant IN ('independent_sales','independent_tech')
          AND public.is_master_company_user(auth.uid())))));
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_access_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / backend
  IF NEW.participant_type IS NOT DISTINCT FROM OLD.participant_type
     AND NEW.network_status IS NOT DISTINCT FROM OLD.network_status
     AND NEW.dispatch_role IS NOT DISTINCT FROM OLD.dispatch_role
     AND NEW.dispatch_active IS NOT DISTINCT FROM OLD.dispatch_active
     AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.subscription_plan IS NOT DISTINCT FROM OLD.subscription_plan
     AND NEW.jobs_limit IS NOT DISTINCT FROM OLD.jobs_limit
     AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at
     AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id THEN
    RETURN NEW;
  END IF;
  IF public.can_manage_profile_access(OLD.company_id, OLD.participant_type) THEN RETURN NEW; END IF;
  -- 'Join as Independent Agent': a fresh user (no company, no roles) may APPLY, pending only.
  IF OLD.id = auth.uid() AND OLD.company_id IS NULL AND OLD.participant_type = 'company_staff'
     AND OLD.network_status IS NULL
     AND NEW.participant_type IN ('independent_sales','independent_tech') AND NEW.network_status = 'pending'
     AND NEW.dispatch_role IS NOT DISTINCT FROM OLD.dispatch_role
     AND NEW.dispatch_active IS NOT DISTINCT FROM OLD.dispatch_active
     AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.subscription_plan IS NOT DISTINCT FROM OLD.subscription_plan
     AND NEW.jobs_limit IS NOT DISTINCT FROM OLD.jobs_limit
     AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at
     AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only an admin or office user of the same company can change participant type, network status, dispatch or subscription settings'
    USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_profile_access_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_access_fields BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_access_fields();

-- Admin/office of the same company can update team profiles (makes Network Agents approve + Team lane work).
DROP POLICY IF EXISTS "Company admins and office can update team profiles" ON public.profiles;
CREATE POLICY "Company admins and office can update team profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id <> auth.uid() AND public.can_manage_profile_access(company_id, participant_type))
  WITH CHECK (public.can_manage_profile_access(company_id, participant_type));

-- field_agent only once an independent is APPROVED (no longer on participant_type alone).
CREATE OR REPLACE FUNCTION public.auto_assign_independent_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.participant_type IN ('independent_sales', 'independent_tech') AND NEW.network_status = 'approved' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'field_agent')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_auto_assign_independent_role ON public.profiles;
CREATE TRIGGER trg_auto_assign_independent_role AFTER INSERT OR UPDATE OF participant_type, network_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_independent_role();

-- New sign-ups: independent applications from sign-up metadata land as PENDING (works with email confirmation on).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_pt text := NEW.raw_user_meta_data->>'participant_type';
BEGIN
  IF v_pt IN ('independent_sales', 'independent_tech') THEN
    INSERT INTO public.profiles (id, full_name, participant_type, network_status)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'), v_pt, 'pending');
  ELSE
    INSERT INTO public.profiles (id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'));
  END IF;
  RETURN NEW;
END;
$function$;