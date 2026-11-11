-- Invitees were filed as public company_new sign-ups, then approved into company
-- onboarding, which rewrote the existing company. Preview only. Do not apply by hand
-- to the live database from this pull request.
--
-- Who can UPDATE public.companies
-- BEFORE (policies left in place, permissive OR):
--   1. "Company admins can update their company" — is_company_admin(auth.uid(), id):
--      company_members.role = 'admin' for that company. Includes the owner when
--      their membership role is admin. Does not include dispatcher, viewer,
--      field_agent, or company_members.role = 'member'.
--   2. "Platform admins can manage all companies" FOR ALL — has_role(auth.uid(), 'admin'):
--      every app-role admin, on every company row. That includes Johan
--      (Massair CT owner, app role admin, company 361bf031-9cdb-4d7f-9bde-9eb95fa4725e,
--      company_members.is_owner) and also a partner-company admin editing Massair.
--   service_role bypasses RLS. Anon has no grant. Field-tech SELECT stays blocked
--   by rh_tech_block. SELECT, INSERT, and DELETE policies are not changed.
-- AFTER (same permissive policies, plus restrictive can_update_company):
--   UPDATE is allowed only when one of the permissive policies matches AND:
--   - company_members.is_owner for that company, or
--   - company_members.role = 'admin' for that company, or
--   - app role admin who is a member of that company, or
--   - platform_super_admin / platform_ops, or
--   - app role admin of Massair CT (361bf031-9cdb-4d7f-9bde-9eb95fa4725e), which
--     keeps Johan’s full company update access, including other companies.
--   Removed: an app-role admin of some other company updating a company they do
--   not belong to. Dispatcher, salesperson, viewer, technician, and plain members
--   stay unable to update.
-- company_settings (rates, banking, deposit, terms) gets the same restrictive
-- UPDATE and INSERT. Its SELECT and DELETE policies stay. companies.default_rate
-- and companies.services are columns on companies, not separate tables; the
-- companies UPDATE policy covers them. Onboarding writes no other rates or
-- services table.

CREATE OR REPLACE FUNCTION public.can_update_company(_uid uuid, _company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL AND _company IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.user_id = _uid AND m.company_id = _company AND m.is_owner
    )
    OR public.is_company_admin(_uid, _company)
    OR (
      public.has_role(_uid, 'admin'::app_role)
      AND (
        EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = _uid AND m.company_id = _company)
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.company_id = _company)
      )
    )
    OR public.has_role(_uid, 'platform_super_admin'::app_role)
    OR public.has_role(_uid, 'platform_ops'::app_role)
    OR (
      public.has_role(_uid, 'admin'::app_role)
      AND public.get_user_company_id(_uid) = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_update_company(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_update_company(uuid, uuid) TO authenticated;

-- Additive only. Existing permissive policies stay, so SELECT/INSERT/DELETE
-- and every current legitimate updater keep their access.
DROP POLICY IF EXISTS companies_owner_admin_update ON public.companies;
CREATE POLICY companies_owner_admin_update ON public.companies
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.can_update_company(auth.uid(), id))
  WITH CHECK (public.can_update_company(auth.uid(), id));

DROP POLICY IF EXISTS company_settings_owner_admin_update ON public.company_settings;
CREATE POLICY company_settings_owner_admin_update ON public.company_settings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.can_update_company(auth.uid(), company_id))
  WITH CHECK (public.can_update_company(auth.uid(), company_id));

DROP POLICY IF EXISTS company_settings_owner_admin_insert ON public.company_settings;
CREATE POLICY company_settings_owner_admin_insert ON public.company_settings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.can_update_company(auth.uid(), company_id));

-- Massair admin, own company (or a public signup that has no company yet).
-- Extends the email lookup used by get_applicant_email without replacing that function.
CREATE OR REPLACE FUNCTION public.get_signup_applicant(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_co uuid;
  v_profile public.profiles%ROWTYPE;
  v_email text;
  v_inv public.team_invites%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN NULL; END IF;
  IF NOT (
    public.has_role(v_caller, 'platform_super_admin'::app_role)
    OR (public.has_role(v_caller, 'admin'::app_role) AND public.is_master_company_user(v_caller))
  ) THEN
    RETURN NULL;
  END IF;
  v_co := public.get_user_company_id(v_caller);
  SELECT * INTO v_profile FROM public.profiles WHERE id = _id;
  IF v_profile.id IS NULL THEN RETURN NULL; END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = _id;
  SELECT * INTO v_inv FROM public.team_invites ti
   WHERE ti.accepted_user_id = _id
      OR (v_email IS NOT NULL AND lower(ti.email) = lower(v_email))
   ORDER BY ti.created_at DESC
   LIMIT 1;
  IF v_profile.company_id IS NOT NULL AND v_profile.company_id IS DISTINCT FROM v_co
     AND (v_inv.id IS NULL OR v_inv.company_id IS DISTINCT FROM v_co) THEN
    RETURN NULL;
  END IF;
  IF v_profile.company_id IS NULL AND v_inv.id IS NOT NULL AND v_inv.company_id IS DISTINCT FROM v_co THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'email', v_email,
    'full_name', v_profile.full_name,
    'signup_role', v_profile.signup_role,
    'dispatch_role', v_profile.dispatch_role,
    'invite_role', v_inv.role,
    'invite_lane', v_inv.dispatch_role,
    'source', CASE WHEN v_inv.id IS NOT NULL THEN 'team_invite' ELSE 'public_signup' END,
    'created', v_profile.created_at
  );
END $$;
REVOKE ALL ON FUNCTION public.get_signup_applicant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_signup_applicant(uuid) TO authenticated;

-- Body starts from 20261111153000_no_login_technicians.sql. The no_login branch
-- is unchanged. Only the invite lookup and the public-signup notice changed.
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

  -- A pending invite is the invite path even before the email is confirmed,
  -- so the profile is never a public company_new application.
  SELECT * INTO v_inv FROM public.team_invites
   WHERE email = lower(NEW.email) AND accepted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;

  IF v_inv.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, company_id, dispatch_role)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), v_inv.company_id, v_inv.dispatch_role);
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_inv.role) ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.company_members (user_id, company_id, role)
    VALUES (NEW.id, v_inv.company_id, CASE WHEN v_inv.role = 'admin' THEN 'admin' ELSE 'member' END)
    ON CONFLICT (user_id, company_id) DO NOTHING;
    -- Accept the invite only after the inbox is confirmed. No company_new notice.
    -- approving_signup lets the profile guard allow network_status / signup_role.
    IF NEW.email_confirmed_at IS NOT NULL /*q4b*/ THEN
      PERFORM set_config('app.approving_signup', 'on', true);
      UPDATE public.team_invites SET accepted_at = now(), accepted_user_id = NEW.id WHERE id = v_inv.id;
      UPDATE public.profiles
         SET signup_role = NULL,
             signup_company = NULL,
             network_status = 'approved',
             onboarding_completed = true
       WHERE id = NEW.id;
      PERFORM set_config('app.approving_signup', 'off', true);
    END IF;
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
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    SELECT DISTINCT ur.user_id, 'network_applicant', 'New sign-up waiting for approval',
           v_name || ' (' || coalesce(NEW.email, 'no email') || ') signed up as ' || replace(v_sr, '_', ' ') || '. Approve or reject on Team → Applications.',
           NEW.id,
           jsonb_build_object(
             'email', NEW.email,
             'full_name', v_name,
             'signup_role', v_sr,
             'source', 'public_signup',
             'created', coalesce(NEW.created_at, now())
           )
      FROM public.user_roles ur
     WHERE ur.role = 'platform_super_admin'
        OR (ur.role = 'admin' AND public.is_master_company_user(ur.user_id));
  END IF;
  RETURN NEW;
END;
$function$;

-- Body starts from docs/db-releases/2026-10-09_q4b_invite_on_confirm.sql.
-- Accepting an invite clears the public signup and finishes onboarding.
CREATE OR REPLACE FUNCTION public.apply_team_invite(p_user uuid, p_email text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v public.team_invites%ROWTYPE; v_co uuid; v_name text;
BEGIN
  IF p_user IS NULL OR p_email IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM public.team_invites WHERE email = lower(p_email) AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v.id IS NULL THEN RETURN NULL; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = p_user;
  IF v_co IS NOT NULL AND v_co IS DISTINCT FROM v.company_id THEN RETURN NULL; END IF; -- already in another company: leave pending
  SELECT COALESCE(
    NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''),
    split_part(p_email, '@', 1)
  ) INTO v_name
  FROM auth.users u WHERE u.id = p_user;
  v_name := COALESCE(v_name, split_part(p_email, '@', 1));
  PERFORM set_config('app.approving_signup', 'on', true);
  INSERT INTO public.profiles (id, full_name, company_id, dispatch_role, signup_role, signup_company, network_status, onboarding_completed)
  VALUES (p_user, v_name, v.company_id, v.dispatch_role, NULL, NULL, 'approved', true)
  ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id,
    dispatch_role = COALESCE(EXCLUDED.dispatch_role, public.profiles.dispatch_role),
    signup_role = NULL,
    signup_company = NULL,
    network_status = 'approved',
    onboarding_completed = true,
    full_name = CASE
      WHEN public.profiles.full_name = 'New User' THEN EXCLUDED.full_name
      ELSE public.profiles.full_name
    END;
  PERFORM set_config('app.approving_signup', 'off', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user, v.role) ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.company_members (user_id, company_id, role)
  VALUES (p_user, v.company_id, CASE WHEN v.role = 'admin' THEN 'admin' ELSE 'member' END)
  ON CONFLICT (user_id, company_id) DO NOTHING;
  UPDATE public.team_invites SET accepted_at = now(), accepted_user_id = p_user WHERE id = v.id;
  RETURN v.id;
END $f$;
REVOKE ALL ON FUNCTION public.apply_team_invite(uuid, text) FROM PUBLIC, anon, authenticated;

-- Body starts from 20261016220000_fieldlynk_five_role_signup.sql.
-- An invitee is not a company_new founder: approving them must not send them
-- into company onboarding.
CREATE OR REPLACE FUNCTION public.approve_company_signup(p_user uuid, p_approve boolean, p_company uuid DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.profiles%ROWTYPE; v_co uuid; v_dr text; v_email text; v_invited boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'platform_super_admin'::app_role)
          OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()))) THEN
    RAISE EXCEPTION 'Only a Massair CT admin can approve sign-ups' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.profiles WHERE id = p_user;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Not a company sign-up'; END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user;
  v_invited := EXISTS (
    SELECT 1 FROM public.team_invites ti
    WHERE ti.accepted_user_id = p_user
       OR (v_email IS NOT NULL AND lower(ti.email) = lower(v_email))
  );
  IF v_invited THEN
    PERFORM set_config('app.approving_signup', 'on', true);
    UPDATE public.profiles
       SET signup_role = NULL,
           signup_company = NULL,
           network_status = 'approved',
           onboarding_completed = true
     WHERE id = p_user;
    PERFORM set_config('app.approving_signup', 'off', true);
    RETURN 'invitee';
  END IF;
  IF v.signup_role IS NULL THEN RAISE EXCEPTION 'Not a company sign-up'; END IF;
  IF v.network_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Already %', v.network_status; END IF;
  PERFORM set_config('app.approving_signup', 'on', true);
  IF NOT p_approve THEN
    UPDATE public.profiles SET network_status = 'rejected' WHERE id = p_user;
    PERFORM set_config('app.approving_signup', 'off', true);
    RETURN 'rejected';
  END IF;
  IF v.signup_role = 'company_new' THEN
    IF v.company_id IS NOT NULL THEN
      -- Already inside a company: do not leave them on the company wizard.
      UPDATE public.profiles
         SET network_status = 'approved', onboarding_completed = true, signup_role = NULL, signup_company = NULL
       WHERE id = p_user;
    ELSE
      -- Approved: they may now finish onboarding and create their company.
      UPDATE public.profiles SET network_status = 'approved' WHERE id = p_user;
    END IF;
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
