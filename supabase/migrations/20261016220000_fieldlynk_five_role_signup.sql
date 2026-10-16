-- Field Lynk login v1: five-role sign-up (2026-10-16). Minimal: 2 nullable columns, 1 check,
-- handle_new_user branch, guard bypass flag used only by approve_company_signup().
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_role text, ADD COLUMN IF NOT EXISTS signup_company text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_signup_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_signup_role_check
  CHECK (signup_role IS NULL OR signup_role IN ('company_new','company_tech','company_sales','massair_dual'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pt text := NEW.raw_user_meta_data->>'participant_type';
  v_sr text := NEW.raw_user_meta_data->>'signup_role';
  v_name text := COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User');
  v_skills text := left(nullif(btrim(NEW.raw_user_meta_data->>'skills'), ''), 2000);
  v_inv public.team_invites%ROWTYPE;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL /*q4b*/ THEN
    SELECT * INTO v_inv FROM public.team_invites
     WHERE email = lower(NEW.email) AND accepted_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_inv.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, company_id, dispatch_role)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), v_inv.company_id, v_inv.dispatch_role);
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_inv.role) ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.company_members (user_id, company_id, role)
    VALUES (NEW.id, v_inv.company_id, CASE WHEN v_inv.role = 'admin' THEN 'admin' ELSE 'member' END)
    ON CONFLICT (user_id, company_id) DO NOTHING;
    UPDATE public.team_invites SET accepted_at = now(), accepted_user_id = NEW.id WHERE id = v_inv.id;
  ELSIF v_pt IN ('independent_sales', 'independent_tech') THEN
    INSERT INTO public.profiles (id, full_name, participant_type, network_status, phone, skills)
    VALUES (NEW.id, v_name, v_pt, 'pending',
            left(nullif(btrim(NEW.raw_user_meta_data->>'phone'), ''), 30),
            CASE WHEN v_skills IS NULL THEN '{}'::text[] ELSE ARRAY[v_skills] END);
  ELSIF v_sr IN ('company_new','company_tech','company_sales','massair_dual') THEN
    -- Step 1 of the two-step rule: sign-ups through the main Massair CT system wait for approval.
    INSERT INTO public.profiles (id, full_name, network_status, phone, signup_role, signup_company)
    VALUES (NEW.id, v_name, 'pending',
            left(nullif(btrim(NEW.raw_user_meta_data->>'phone'), ''), 30), v_sr,
            CASE WHEN v_sr = 'massair_dual' THEN 'Massair CT (Pty) Ltd'
                 ELSE left(nullif(btrim(NEW.raw_user_meta_data->>'company_name'), ''), 160) END);
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    SELECT DISTINCT ur.user_id, 'network_applicant', 'New sign-up waiting for approval',
           v_name || ' signed up (' || replace(v_sr, '_', ' ') || '). Approve or reject on Team → Applications.', NEW.id
      FROM public.user_roles ur
     WHERE ur.role = 'platform_super_admin'
        OR (ur.role = 'admin' AND public.is_master_company_user(ur.user_id));
  ELSE
    INSERT INTO public.profiles (id, full_name) VALUES (NEW.id, v_name);
  END IF;
  RETURN NEW;
END;
$function$;

-- Guard: one bypass, set only (transaction-local) inside approve_company_signup().
CREATE OR REPLACE FUNCTION public.guard_profile_access_fields()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / backend
  IF current_setting('app.approving_signup', true) = 'on' THEN RETURN NEW; END IF; -- approve_company_signup()
  IF NEW.participant_type IS NOT DISTINCT FROM OLD.participant_type
     AND NEW.network_status IS NOT DISTINCT FROM OLD.network_status
     AND NEW.dispatch_role IS NOT DISTINCT FROM OLD.dispatch_role
     AND NEW.dispatch_active IS NOT DISTINCT FROM OLD.dispatch_active
     AND NEW.subscription_status IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.subscription_plan IS NOT DISTINCT FROM OLD.subscription_plan
     AND NEW.jobs_limit IS NOT DISTINCT FROM OLD.jobs_limit
     AND NEW.trial_ends_at IS NOT DISTINCT FROM OLD.trial_ends_at
     AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
     AND NEW.signup_role IS NOT DISTINCT FROM OLD.signup_role THEN
    RETURN NEW;
  END IF;
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
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
     AND NEW.signup_role IS NOT DISTINCT FROM OLD.signup_role
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  IF OLD.participant_type IN ('independent_sales','independent_tech')
     AND (NEW.network_status IS DISTINCT FROM OLD.network_status
          OR NEW.participant_type IS DISTINCT FROM OLD.participant_type
          OR NEW.archived_at IS DISTINCT FROM OLD.archived_at) THEN
    IF public.has_role(auth.uid(), 'platform_super_admin'::app_role)
       OR (public.has_role(auth.uid(), 'admin'::app_role)
           AND public.can_manage_profile_access(OLD.company_id, OLD.participant_type)) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only an admin can approve, reject or archive a freelancer'
      USING ERRCODE = '42501';
  END IF;
  IF public.can_manage_profile_access(OLD.company_id, OLD.participant_type) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Only an admin or office user of the same company can change participant type, network status, dispatch or subscription settings'
    USING ERRCODE = '42501';
END;
$function$;

-- Step 2: a Massair CT admin (or platform super admin) approves or rejects.
CREATE OR REPLACE FUNCTION public.approve_company_signup(p_user uuid, p_approve boolean, p_company uuid DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.profiles%ROWTYPE; v_co uuid; v_dr text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'platform_super_admin'::app_role)
          OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()))) THEN
    RAISE EXCEPTION 'Only a Massair CT admin can approve sign-ups' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.profiles WHERE id = p_user;
  IF v.id IS NULL OR v.signup_role IS NULL THEN RAISE EXCEPTION 'Not a company sign-up'; END IF;
  IF v.network_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Already %', v.network_status; END IF;
  PERFORM set_config('app.approving_signup', 'on', true);
  IF NOT p_approve THEN
    UPDATE public.profiles SET network_status = 'rejected' WHERE id = p_user;
    PERFORM set_config('app.approving_signup', 'off', true);
    RETURN 'rejected';
  END IF;
  IF v.signup_role = 'company_new' THEN
    -- Approved: they may now finish onboarding and create their company.
    UPDATE public.profiles SET network_status = 'approved' WHERE id = p_user;
  ELSE
    v_co := CASE WHEN v.signup_role = 'massair_dual' THEN (SELECT id FROM public.companies WHERE is_master LIMIT 1) ELSE p_company END;
    IF v_co IS NULL THEN RAISE EXCEPTION 'Pick the company to add them to'; END IF;
    v_dr := CASE v.signup_role WHEN 'company_tech' THEN 'technician' WHEN 'company_sales' THEN 'sales' ELSE 'sales_engineer' END;
    UPDATE public.profiles SET company_id = v_co, dispatch_role = v_dr, network_status = 'approved' WHERE id = p_user;
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user, 'field_agent') ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.company_members (user_id, company_id, role) VALUES (p_user, v_co, 'member')
      ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;
  PERFORM set_config('app.approving_signup', 'off', true);
  RETURN 'approved';
END;
$function$;
REVOKE ALL ON FUNCTION public.approve_company_signup(uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_company_signup(uuid, boolean, uuid) TO authenticated;
