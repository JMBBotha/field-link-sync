-- Preview only. Do not apply to the live database until the go-live steps in the PR are followed.
-- Adds technicians who can be booked and have work logged against them, without an email invite.
--
-- Why an auth user (not a separate staff table): profiles.id references auth.users(id), and
-- visits, assignments, and earnings already use that id. A second staff model would split
-- the person. auth.admin.createUser (service role, email_confirm, no password, banned,
-- placeholder @no-login.fieldlynk.invalid) keeps one id. Send-login later changes that
-- same user's email. app_metadata.provision is not client-writable, so a public sign-up
-- cannot take this branch.
--
-- Rollback (manual): drop the triggers created below, drop public.auth_user_id_for_email
-- and public.clear_no_login_after_sign_in, drop profiles.no_login, then restore
-- handle_new_user, find_dispatch_candidates, find_dispatch_candidates_multi,
-- dispatchable_technicians, and fl_alert_deliver from the previous migration versions.
-- Do not delete auth users created by the function unless that is an explicit decision
-- (profiles cascade from auth.users).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS no_login boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.no_login IS
  'Admin-added technician with no sign-in yet. Bookable and attributable. Excluded from live offers, push, location, and device alerts until they sign in.';

-- Keep location sharing off while they have no device. Cleared only when no_login flips off.
CREATE OR REPLACE FUNCTION public.freeze_nologin_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.no_login, false) THEN
    NEW.location_tracking_enabled := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_freeze_nologin_location ON public.profiles;
CREATE TRIGGER trg_freeze_nologin_location
  BEFORE INSERT OR UPDATE OF no_login, location_tracking_enabled ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.freeze_nologin_location();

-- Live offers never land on a no-login technician (lead broadcast and install rounds).
CREATE OR REPLACE FUNCTION public.skip_nologin_offer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.staff_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = NEW.staff_id AND coalesce(p.no_login, false)
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_skip_nologin_offer ON public.offers;
CREATE TRIGGER trg_skip_nologin_offer
  BEFORE INSERT ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.skip_nologin_offer();

CREATE OR REPLACE FUNCTION public.skip_nologin_request_offer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.rep_id AND coalesce(p.no_login, false)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_skip_nologin_request_offer ON public.request_offers;
CREATE TRIGGER trg_skip_nologin_request_offer
  BEFORE INSERT ON public.request_offers
  FOR EACH ROW EXECUTE FUNCTION public.skip_nologin_request_offer();

-- No inbox until they sign in. Office alerts go to admin and dispatcher ids, not this row.
CREATE OR REPLACE FUNCTION public.skip_nologin_notification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = NEW.user_id AND coalesce(p.no_login, false)
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_skip_nologin_notification ON public.notifications;
CREATE TRIGGER trg_skip_nologin_notification
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.skip_nologin_notification();

-- Late check-in and en-route alerts assume a device. Skip them when the assignee has none.
-- An unassigned job (profile_id null) still alerts the office.
CREATE OR REPLACE FUNCTION public.skip_nologin_device_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL
     AND NEW.rule IN ('no_en_route', 'not_started', 'not_accepted', 'not_accepted_urgent', 'not_finished')
     AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = NEW.profile_id AND coalesce(p.no_login, false)
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_skip_nologin_device_alert ON public.job_alerts;
CREATE TRIGGER trg_skip_nologin_device_alert
  BEFORE INSERT ON public.job_alerts
  FOR EACH ROW EXECUTE FUNCTION public.skip_nologin_device_alert();

-- Push subscriptions and the outbox assume a device.
CREATE OR REPLACE FUNCTION public.skip_nologin_push()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.user_id AND coalesce(p.no_login, false)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_skip_nologin_push_outbox ON public.push_outbox;
CREATE TRIGGER trg_skip_nologin_push_outbox
  BEFORE INSERT ON public.push_outbox
  FOR EACH ROW EXECUTE FUNCTION public.skip_nologin_push();

DROP TRIGGER IF EXISTS trg_skip_nologin_push_sub ON public.push_subscriptions;
CREATE TRIGGER trg_skip_nologin_push_sub
  BEFORE INSERT ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.skip_nologin_push();

-- No location row for someone with no device (record_my_location_ping also refuses
-- because location_tracking_enabled is forced off).
CREATE OR REPLACE FUNCTION public.block_nologin_location_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.agent_id AND coalesce(p.no_login, false)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_nologin_location ON public.agent_locations;
CREATE TRIGGER trg_block_nologin_location
  BEFORE INSERT OR UPDATE ON public.agent_locations
  FOR EACH ROW EXECUTE FUNCTION public.block_nologin_location_write();

-- Candidate lists used by broadcast and dispatch-service-job. Manual assignment
-- (dispatchable_technicians / Book a job) does not use these functions.
CREATE OR REPLACE FUNCTION public.find_dispatch_candidates(
  p_lead_id uuid,
  p_role text,
  p_radius_km numeric DEFAULT 40,
  p_skill text DEFAULT NULL
)
RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (SELECT location, company_id FROM public.leads WHERE id = p_lead_id)
  SELECT p.id,
         p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
    AND coalesce(p.no_login, false) = false
    AND p.dispatch_role = p_role
    AND p.home_location IS NOT NULL
    AND l.location IS NOT NULL
    AND (l.company_id IS NULL OR p.company_id = l.company_id OR p.participant_type IN ('independent_sales','independent_tech'))
    AND ST_DWithin(p.home_location, l.location, p_radius_km * 1000)
    AND (p_skill IS NULL OR p_skill = ANY(COALESCE(p.skills, ARRAY[]::text[])))
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
  ORDER BY distance_km ASC;
$$;

REVOKE ALL ON FUNCTION public.find_dispatch_candidates(uuid,text,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_dispatch_candidates(uuid,text,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.find_dispatch_candidates_multi(
  p_lead_id uuid,
  p_role text,
  p_radius_km numeric,
  p_skills text[] DEFAULT NULL
)
RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH l AS (SELECT location, company_id FROM public.leads WHERE id = p_lead_id)
  SELECT p.id,
         p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
    AND coalesce(p.no_login, false) = false
    AND p.dispatch_role = p_role
    AND p.home_location IS NOT NULL
    AND l.location IS NOT NULL
    AND (l.company_id IS NULL OR p.company_id = l.company_id OR p.participant_type IN ('independent_sales','independent_tech'))
    AND ST_DWithin(p.home_location, l.location, p_radius_km * 1000)
    AND (
      p_skills IS NULL
      OR array_length(p_skills, 1) IS NULL
      OR COALESCE(p.skills, ARRAY[]::text[]) && p_skills
    )
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
  ORDER BY distance_km ASC;
$$;

REVOKE ALL ON FUNCTION public.find_dispatch_candidates_multi(uuid, text, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_dispatch_candidates_multi(uuid, text, numeric, text[]) TO service_role;

-- Manual assign (job page Assign, backfill). No-login technicians are included even
-- when offline: the office books them, they have no phone to mark Available.
-- Live offers do not use this function.
CREATE OR REPLACE FUNCTION public.dispatchable_technicians(_company_id uuid)
 RETURNS TABLE(profile_id uuid, full_name text, participant_type text, assignment_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT auth.uid() IS NULL
        OR public.is_company_member(auth.uid(), _company_id)
        OR public.has_role(auth.uid(), 'platform_super_admin'::app_role) AS ok
  ), techs AS (
    SELECT p.id, p.full_name, p.participant_type, 'internal'::text AS assignment_type, 1 AS pri
    FROM public.company_members cm JOIN public.profiles p ON p.id = cm.user_id
    WHERE cm.company_id = _company_id
    UNION ALL
    SELECT p.id, p.full_name, p.participant_type,
           CASE WHEN a.listed_as_staff THEN 'internal' ELSE 'affiliated' END, 2
    FROM public.agent_affiliations a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.company_id = _company_id AND a.status = 'active'
      AND a.affiliation_type IN ('technical', 'both')
      AND p.participant_type = 'independent_tech' AND p.network_status = 'approved'
  )
  SELECT DISTINCT ON (t.id) t.id, t.full_name, t.participant_type, t.assignment_type
  FROM techs t, allowed
  WHERE allowed.ok
    AND (SELECT p.archived_at FROM public.profiles p WHERE p.id = t.id) IS NULL
    AND COALESCE((SELECT p.dispatch_active FROM public.profiles p WHERE p.id = t.id), true)
    AND (
      public.staff_is_available(t.id)
      OR COALESCE((SELECT p.no_login FROM public.profiles p WHERE p.id = t.id), false)
    )
    AND public.has_role(t.id, 'field_agent'::app_role)
    AND NOT public.has_role(t.id, 'admin'::app_role)
    AND NOT public.has_role(t.id, 'dispatcher'::app_role)
    AND NOT public.is_company_admin(t.id, _company_id)
    AND COALESCE((SELECT p.dispatch_role FROM public.profiles p WHERE p.id = t.id), 'technician') = 'technician'
  ORDER BY t.id, t.pri;
$function$;

-- Push hook: do not queue a device notification for a no-login technician.
CREATE OR REPLACE FUNCTION public.fl_alert_deliver(p_user uuid, p_type text, p_title text, p_body text, p_related uuid, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF nullif(p_meta->>'company_id', '') IS NOT NULL
     AND NOT public.is_company_writable((p_meta->>'company_id')::uuid) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND coalesce(p.no_login, false)) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications(user_id, type, title, body, related_id, metadata, read)
  VALUES (p_user, p_type, p_title, p_body, p_related, coalesce(p_meta, '{}'::jsonb), false)
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF coalesce((p_meta->>'push')::boolean, false)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND coalesce(p.no_login, false))
     AND EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p_user) THEN
    INSERT INTO public.push_outbox(notification_id, user_id, title, body, url)
    SELECT v_id, p_user, t.title, t.body, t.url FROM public.fl_push_text(p_type, p_related) t;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fl_alert_deliver(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- Service role only. Used when linking a real email onto the same auth user.
CREATE OR REPLACE FUNCTION public.auth_user_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_for_email(text) TO service_role;

-- First real sign-in (email no longer the placeholder) ends the no-login exclusion.
CREATE OR REPLACE FUNCTION public.clear_no_login_after_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_sign_in_at IS NOT NULL
     AND NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at
     AND lower(coalesce(NEW.email, '')) NOT LIKE '%@no-login.fieldlynk.invalid' THEN
    UPDATE public.profiles
       SET no_login = false
     WHERE id = NEW.id AND no_login = true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clear_no_login_after_sign_in ON auth.users;
CREATE TRIGGER trg_clear_no_login_after_sign_in
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.clear_no_login_after_sign_in();

-- Sign-up trigger. The no-login branch runs only when the service role set
-- app_metadata.provision. It does not notify platform admins and does not
-- create a pending company application.
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
      v_sr := 'company_new';
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
