-- Release A (auth hardening), 2026-10-16. Approval hold enforced in the database.
-- Helpers -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fl_is_founder_approved(_u uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _u AND p.company_id IS NULL
                 AND p.signup_role = 'company_new' AND p.network_status = 'approved') $$;

-- A company with no profiles and no members yet (just created by its founder).
CREATE OR REPLACE FUNCTION public.fl_company_unclaimed(_co uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.company_members WHERE company_id = _co)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE company_id = _co) $$;

CREATE OR REPLACE FUNCTION public.fl_staff_manager(_u uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.p4_is_platform() OR public.has_role(_u, 'admin'::app_role) OR public.is_office_staff(_u) $$;

CREATE OR REPLACE FUNCTION public.fl_in_company(_u uuid, _co uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _u AND p.company_id = _co)
      OR EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = _u AND m.company_id = _co) $$;

-- Companies: only admins/platform, or an approved new-company founder, may create one.
DROP POLICY IF EXISTS fl_hold_companies_insert ON public.companies;
CREATE POLICY fl_hold_companies_insert ON public.companies AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.p4_is_platform() OR public.has_role(auth.uid(), 'admin'::app_role)
              OR public.fl_is_founder_approved(auth.uid()));

-- Roles: nobody grants themselves a role unless they already manage staff, or they are an
-- approved founder taking 'admin' for their new company. Granting to others needs admin/office/platform.
DROP POLICY IF EXISTS fl_hold_roles_insert ON public.user_roles;
CREATE POLICY fl_hold_roles_insert ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.fl_staff_manager(auth.uid())
              OR (user_id = auth.uid() AND role = 'admin'::app_role AND public.fl_is_founder_approved(auth.uid())));
DROP POLICY IF EXISTS fl_hold_roles_update ON public.user_roles;
CREATE POLICY fl_hold_roles_update ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.fl_staff_manager(auth.uid())) WITH CHECK (public.fl_staff_manager(auth.uid()));

-- Members: add people only to a company you belong to, or claim a brand-new empty company you founded.
DROP POLICY IF EXISTS fl_hold_members_insert ON public.company_members;
CREATE POLICY fl_hold_members_insert ON public.company_members AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.p4_is_platform()
              OR public.fl_in_company(auth.uid(), company_id)
              OR (user_id = auth.uid() AND public.fl_company_unclaimed(company_id)));

-- Profiles: company assignment only by platform, by someone already in that company, or a founder claiming an empty company.
CREATE OR REPLACE FUNCTION public.prevent_company_self_assignment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     AND auth.uid() IS NOT NULL
     AND current_setting('app.approving_signup', true) IS DISTINCT FROM 'on' THEN
    IF NOT public.has_role(auth.uid(), 'admin'::app_role)
       AND NOT public.has_role(auth.uid(), 'platform_super_admin'::app_role) THEN
      RAISE EXCEPTION 'Only administrators can change a profile company assignment';
    END IF;
    IF NEW.company_id IS NOT NULL AND NOT public.p4_is_platform()
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.company_id = NEW.company_id)
       AND NOT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = auth.uid() AND m.company_id = NEW.company_id)
       AND NOT (NEW.id = auth.uid() AND public.fl_company_unclaimed(NEW.company_id)) THEN
      RAISE EXCEPTION 'You can only assign people to your own company';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Sign-up trigger: no-role sign-ups default to a pending new-company application; company name saved for new companies too.
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
-- Release A part 2: the one legitimate self-service company creation path (approved founders only).
CREATE OR REPLACE FUNCTION public.fl_found_company(p_name text, p_slug text, p_rate numeric, p_services text[])
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.fl_is_founder_approved(v_uid) THEN
    RAISE EXCEPTION 'Your sign-up needs Massair CT approval before you can create a company' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Company name is required'; END IF;
  INSERT INTO public.companies (name, slug, vat_rate, default_rate, services, onboarding_completed)
  VALUES (left(btrim(p_name), 160), nullif(p_slug, ''), 0.15, p_rate, coalesce(p_services, '{}'), true)
  RETURNING id INTO v_co;
  PERFORM set_config('app.approving_signup', 'on', true);
  UPDATE public.profiles SET company_id = v_co WHERE id = v_uid;
  PERFORM set_config('app.approving_signup', 'off', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.company_members (user_id, company_id, role) VALUES (v_uid, v_co, 'admin')
    ON CONFLICT (user_id, company_id) DO NOTHING;
  RETURN v_co;
END;
$function$;
REVOKE ALL ON FUNCTION public.fl_found_company(text, text, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fl_found_company(text, text, numeric, text[]) TO authenticated;
-- Release A part 3: role grants only to people in your own company; companies created directly only by admins/platform.
CREATE OR REPLACE FUNCTION public.fl_shares_company(_a uuid, _b uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM (SELECT company_id FROM public.profiles WHERE id = _a AND company_id IS NOT NULL
                   UNION SELECT company_id FROM public.company_members WHERE user_id = _a) a
    JOIN (SELECT company_id FROM public.profiles WHERE id = _b AND company_id IS NOT NULL
          UNION SELECT company_id FROM public.company_members WHERE user_id = _b) b USING (company_id)) $$;
DROP POLICY IF EXISTS fl_hold_roles_insert ON public.user_roles;
CREATE POLICY fl_hold_roles_insert ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.p4_is_platform()
              OR (public.fl_staff_manager(auth.uid()) AND (user_id = auth.uid() OR public.fl_shares_company(auth.uid(), user_id))));
DROP POLICY IF EXISTS fl_hold_roles_update ON public.user_roles;
CREATE POLICY fl_hold_roles_update ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.p4_is_platform() OR (public.fl_staff_manager(auth.uid()) AND (user_id = auth.uid() OR public.fl_shares_company(auth.uid(), user_id))))
  WITH CHECK (public.p4_is_platform() OR (public.fl_staff_manager(auth.uid()) AND (user_id = auth.uid() OR public.fl_shares_company(auth.uid(), user_id))));
DROP POLICY IF EXISTS fl_hold_companies_insert ON public.companies;
CREATE POLICY fl_hold_companies_insert ON public.companies AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.p4_is_platform() OR public.has_role(auth.uid(), 'admin'::app_role));
