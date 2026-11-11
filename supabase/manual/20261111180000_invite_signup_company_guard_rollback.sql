-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Restores handle_new_user, apply_team_invite, and approve_company_signup to the
-- bodies this change started from, and removes the company-update guard.
-- SELECT, INSERT, and DELETE policies were not changed and are not restored here.

DROP POLICY IF EXISTS companies_owner_admin_update ON public.companies;
DROP POLICY IF EXISTS company_settings_owner_admin_update ON public.company_settings;
DROP POLICY IF EXISTS company_settings_owner_admin_insert ON public.company_settings;
DROP FUNCTION IF EXISTS public.get_signup_applicant(uuid);
DROP FUNCTION IF EXISTS public.can_update_company(uuid, uuid);

-- handle_new_user from 20261111153000_no_login_technicians.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pt text := NEW.raw_user_meta_data->>'participant_type';
  v_sr text := NEW.raw_user_meta_data->>'signup_role';
  v_name text := COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User');
  v_skills text := left(nullif(btrim(NEW.raw_user_meta_data->>'skills'), ''), 2000);
  v_inv public.team_invites%ROWTYPE;
BEGIN
  IF coalesce(NEW.raw_app_meta_data->>'provision', '') = 'no_login_technician' THEN
    INSERT INTO public.profiles (
      id, full_name, phone, company_id, dispatch_role, dispatch_active,
      participant_type, no_login, location_tracking_enabled, availability_status
    ) VALUES (
      NEW.id,
      COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), 'Technician'),
      left(nullif(btrim(NEW.raw_user_meta_data->>'phone'), ''), 30),
      NULLIF(NEW.raw_app_meta_data->>'company_id', '')::uuid,
      'technician',
      true,
      'company_staff',
      true,
      false,
      'offline'
    );
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'field_agent')
    ON CONFLICT (user_id, role) DO NOTHING;
    IF NULLIF(NEW.raw_app_meta_data->>'company_id', '') IS NOT NULL THEN
      INSERT INTO public.company_members (user_id, company_id, role)
      VALUES (NEW.id, (NEW.raw_app_meta_data->>'company_id')::uuid, 'member')
      ON CONFLICT (user_id, company_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

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
  ELSE
    IF v_sr IS NULL OR v_sr NOT IN ('company_new','company_tech','company_sales','massair_dual') THEN
      v_sr := 'company_new'; -- direct/no-role sign-up: held as a new-company application
    END IF;
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
  END IF;
  RETURN NEW;
END;
$function$;

-- apply_team_invite from docs/db-releases/2026-10-09_q4b_invite_on_confirm.sql
CREATE OR REPLACE FUNCTION public.apply_team_invite(p_user uuid, p_email text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v public.team_invites%ROWTYPE; v_co uuid;
BEGIN
  IF p_user IS NULL OR p_email IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM public.team_invites WHERE email = lower(p_email) AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v.id IS NULL THEN RETURN NULL; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = p_user;
  IF v_co IS NOT NULL AND v_co IS DISTINCT FROM v.company_id THEN RETURN NULL; END IF; -- already in another company: leave pending
  INSERT INTO public.profiles (id, full_name, company_id, dispatch_role)
  VALUES (p_user, split_part(p_email, '@', 1), v.company_id, v.dispatch_role)
  ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id,
    dispatch_role = COALESCE(EXCLUDED.dispatch_role, public.profiles.dispatch_role);
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user, v.role) ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.company_members (user_id, company_id, role)
  VALUES (p_user, v.company_id, CASE WHEN v.role = 'admin' THEN 'admin' ELSE 'member' END)
  ON CONFLICT (user_id, company_id) DO NOTHING;
  UPDATE public.team_invites SET accepted_at = now(), accepted_user_id = p_user WHERE id = v.id;
  RETURN v.id;
END $f$;
REVOKE ALL ON FUNCTION public.apply_team_invite(uuid, text) FROM PUBLIC, anon, authenticated;

-- approve_company_signup from 20261016220000_fieldlynk_five_role_signup.sql
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
