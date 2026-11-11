-- Live bodies captured 11 Nov 2026, before the no-login migration. Diff baseline only.
CREATE OR REPLACE FUNCTION public.dispatchable_technicians(_company_id uuid)
 RETURNS TABLE(profile_id uuid, full_name text, participant_type text, assignment_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH allowed AS (
    SELECT auth.uid() IS NULL                      -- service role (dispatch-job)
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
    AND public.staff_is_available(t.id)
    AND public.has_role(t.id, 'field_agent'::app_role)
    AND NOT public.has_role(t.id, 'admin'::app_role)
    AND NOT public.has_role(t.id, 'dispatcher'::app_role)
    AND NOT public.is_company_admin(t.id, _company_id)
    AND COALESCE((SELECT p.dispatch_role FROM public.profiles p WHERE p.id = t.id), 'technician') = 'technician'
  ORDER BY t.id, t.pri;
$function$;

CREATE OR REPLACE FUNCTION public.find_dispatch_candidates_multi(p_lead_id uuid, p_role text, p_radius_km numeric, p_skills text[] DEFAULT NULL::text[])
 RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH l AS (SELECT id, location, company_id, scheduled_date, scheduled_time,
                    (scheduled_time + make_interval(mins => COALESCE(estimated_duration_minutes,
                       public.default_booking_minutes(CASE WHEN primary_intent::text = 'sales' THEN 'sales' ELSE service_type END))))::time AS end_time
             FROM public.leads WHERE id = p_lead_id AND public.rh_ops_ok(company_id) /*rh*/)
  SELECT p.id, p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
    AND p.dispatch_role = p_role
    AND p.home_location IS NOT NULL
    AND l.location IS NOT NULL
    AND (l.company_id IS NULL OR p.company_id = l.company_id OR p.participant_type IN ('independent_sales','independent_tech'))
    AND ST_DWithin(p.home_location, l.location, p_radius_km * 1000)
    AND (p_skills IS NULL OR array_length(p_skills, 1) IS NULL OR COALESCE(p.skills, ARRAY[]::text[]) && p_skills)
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
    AND (l.scheduled_date IS NULL OR l.scheduled_time IS NULL OR NOT EXISTS (
      SELECT 1 FROM public._person_bookings(p.id, l.scheduled_date) b
      WHERE b.lead_id IS DISTINCT FROM l.id AND b.start_time < l.end_time AND b.end_time > l.scheduled_time))
  ORDER BY distance_km ASC;
$function$;

CREATE OR REPLACE FUNCTION public.find_dispatch_candidates(p_lead_id uuid, p_role text, p_radius_km numeric DEFAULT 40, p_skill text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH l AS (SELECT id, location, company_id, scheduled_date, scheduled_time,
                    (scheduled_time + make_interval(mins => COALESCE(estimated_duration_minutes,
                       public.default_booking_minutes(CASE WHEN primary_intent::text = 'sales' THEN 'sales' ELSE service_type END))))::time AS end_time
             FROM public.leads WHERE id = p_lead_id AND public.rh_ops_ok(company_id) /*rh*/)
  SELECT p.id, p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
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
    AND (l.scheduled_date IS NULL OR l.scheduled_time IS NULL OR NOT EXISTS (
      SELECT 1 FROM public._person_bookings(p.id, l.scheduled_date) b
      WHERE b.lead_id IS DISTINCT FROM l.id AND b.start_time < l.end_time AND b.end_time > l.scheduled_time))
  ORDER BY distance_km ASC;
$function$;

CREATE OR REPLACE FUNCTION public.fl_alert_deliver(p_user uuid, p_type text, p_title text, p_body text, p_related uuid, p_meta jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF nullif(p_meta->>'company_id', '') IS NOT NULL
     AND NOT public.is_company_writable((p_meta->>'company_id')::uuid) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications(user_id, type, title, body, related_id, metadata, read)
  VALUES (p_user, p_type, p_title, p_body, p_related, coalesce(p_meta, '{}'::jsonb), false)
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF coalesce((p_meta->>'push')::boolean, false)
     AND EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p_user) THEN
    INSERT INTO public.push_outbox(notification_id, user_id, title, body, url)
    SELECT v_id, p_user, t.title, t.body, t.url FROM public.fl_push_text(p_type, p_related) t;
  END IF;
  RETURN v_id;
END $function$;

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
