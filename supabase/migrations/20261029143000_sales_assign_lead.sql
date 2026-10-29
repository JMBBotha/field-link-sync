-- Sales can assign UNASSIGNED service leads to technicians in their own company; for assigned
-- leads they can only request reassignment (admin decides). Admin/office keep full assign/reassign.
-- Company always comes from the lead + auth.uid() server-side; client company is never trusted.

-- Job type(s) + job information for the assigned tech (existing single service_type/job_type untouched).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS job_types text[];
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS job_info text;
DO $c$ BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT leads_job_types_chk CHECK (job_types IS NULL OR job_types <@ ARRAY['service','repair','installation']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $c$;

CREATE TABLE IF NOT EXISTS public.lead_assignment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  tech_id uuid NOT NULL,
  previous_agent_id uuid,
  assigned_by uuid NOT NULL,
  by_role text NOT NULL,
  scheduled_date date, start_time time, end_time time,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_assignment_log_lead_idx ON public.lead_assignment_log(lead_id, created_at DESC);
ALTER TABLE public.lead_assignment_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_reassign_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  preferred_tech_id uuid,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_reassign_one_pending ON public.lead_reassign_requests(lead_id, requested_by) WHERE status = 'pending';
ALTER TABLE public.lead_reassign_requests ENABLE ROW LEVEL SECURITY;

-- Office (admin-level) dispatcher for a company: admin / super admin / company admin / non-sales dispatcher, same company.
CREATE OR REPLACE FUNCTION public._lead_office(p_uid uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_uid IS NOT NULL AND (
    public.has_role(p_uid, 'platform_super_admin'::app_role)
    OR public.is_company_admin(p_uid, p_company)
    OR (public.get_user_company_id(p_uid) = p_company AND (
          public.has_role(p_uid, 'admin'::app_role)
          OR (public.has_role(p_uid, 'dispatcher'::app_role) AND NOT public.is_sales_rep(p_uid)))))
$$;

-- Read: office sees all rows of its company; a requester sees own requests. No direct writes (functions only).
DROP POLICY IF EXISTS lal_office_read ON public.lead_assignment_log;
CREATE POLICY lal_office_read ON public.lead_assignment_log FOR SELECT TO authenticated USING (public._lead_office(auth.uid(), company_id));
DROP POLICY IF EXISTS lrr_read ON public.lead_reassign_requests;
CREATE POLICY lrr_read ON public.lead_reassign_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public._lead_office(auth.uid(), company_id));
REVOKE INSERT, UPDATE, DELETE ON public.lead_assignment_log, public.lead_reassign_requests FROM anon, authenticated;

-- Technicians of the company (any availability), same eligibility as dispatchable_technicians minus the Available filter.
CREATE OR REPLACE FUNCTION public._company_tech_ok(p_tech uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members cm JOIN public.profiles p ON p.id = cm.user_id
                  WHERE cm.company_id = p_company AND p.id = p_tech AND p.archived_at IS NULL
                    AND COALESCE(p.dispatch_active, true)
                    AND COALESCE(p.dispatch_role, 'technician') = 'technician')
     AND public.has_role(p_tech, 'field_agent'::app_role)
     AND NOT public.has_role(p_tech, 'admin'::app_role)
     AND NOT public.has_role(p_tech, 'dispatcher'::app_role)
     AND NOT public.is_company_admin(p_tech, p_company)
$$;

CREATE OR REPLACE FUNCTION public._km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL ELSE
    round((6371 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))::numeric, 1) END
$$;

-- Everything the Assign dialog needs. Techs: name + status + km only (no locations, no phones).
DROP FUNCTION IF EXISTS public.lead_assign_options(uuid);
-- p_date: the day being booked; each tech gets that day's booked slots (times only, no client details).
CREATE OR REPLACE FUNCTION public.lead_assign_options(p_lead_id uuid, p_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; v_office boolean; v_sales boolean; v_mode text; v_day date;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead_id AND deleted_at IS NULL;
  v_day := COALESCE(p_date, l.scheduled_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
  IF l.id IS NULL OR v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Lead not found'); END IF;
  v_office := public._lead_office(v_uid, l.company_id);
  v_sales := NOT v_office AND public.is_sales_rep(v_uid) AND public.get_user_company_id(v_uid) = l.company_id;
  IF NOT (v_office OR v_sales) THEN RETURN jsonb_build_object('ok', false, 'message', 'Lead not found'); END IF;
  v_mode := CASE WHEN v_office THEN (CASE WHEN l.assigned_agent_id IS NULL THEN 'assign' ELSE 'reassign' END)
                 WHEN l.assigned_agent_id IS NULL THEN 'assign' ELSE 'request' END;
  RETURN jsonb_build_object('ok', true, 'mode', v_mode, 'office', v_office,
    'lead', jsonb_build_object('id', l.id, 'name', l.customer_name, 'service_type', l.service_type,
       'lane', l.primary_intent, 'scheduled_date', l.scheduled_date, 'scheduled_time', l.scheduled_time,
       'minutes', COALESCE(l.estimated_duration_minutes, 120), 'day', v_day, 'job_types', l.job_types, 'job_info', l.job_info,
       'assigned_name', (SELECT full_name FROM public.profiles WHERE id = l.assigned_agent_id)),
    'techs', COALESCE((SELECT jsonb_agg(t ORDER BY (t->>'rank')::int, (t->>'km')::numeric NULLS LAST, t->>'full_name') FROM (
        SELECT jsonb_build_object('id', p.id, 'full_name', trim(p.full_name),
                 'status', COALESCE(p.availability_status, 'offline'),
                 'rank', CASE COALESCE(p.availability_status, 'offline') WHEN 'available' THEN 0 WHEN 'busy' THEN 1 ELSE 2 END,
                 'km', public._km(l.latitude, l.longitude,
                         COALESCE(al.latitude, p.home_base_lat, p.home_lat, p.workshop_lat, p.office_lat),
                         COALESCE(al.longitude, p.home_base_lng, p.home_lng, p.workshop_lng, p.office_lng)),
                 'current', p.id = l.assigned_agent_id,
                 'day_slots', COALESCE((SELECT jsonb_agg(x.slot ORDER BY x.slot) FROM (
                      SELECT to_char(js.start_time, 'HH24:MI') || '–' || to_char(js.end_time, 'HH24:MI') AS slot
                        FROM public.job_schedules js
                       WHERE js.agent_id = p.id AND js.scheduled_date = v_day AND js.lead_id IS DISTINCT FROM l.id
                      UNION
                      SELECT to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || ' job'
                        FROM public.assignments a JOIN public.jobs j ON j.id = a.job_id
                       WHERE a.profile_id = p.id AND (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date = v_day
                         AND j.status::text NOT IN ('completed','cancelled','canceled')
                         AND NOT EXISTS (SELECT 1 FROM public.job_schedules js2 WHERE js2.job_id = j.id AND js2.agent_id = p.id AND js2.scheduled_date = v_day)) x), '[]'::jsonb)) t
          FROM public.company_members cm JOIN public.profiles p ON p.id = cm.user_id
          LEFT JOIN LATERAL (SELECT a.latitude, a.longitude FROM public.agent_locations a WHERE a.agent_id = p.id ORDER BY a.last_updated DESC NULLS LAST LIMIT 1) al ON true
         WHERE cm.company_id = l.company_id AND public._company_tech_ok(p.id, l.company_id)) s), '[]'::jsonb),
    'requests', CASE WHEN v_office THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'by', (SELECT full_name FROM public.profiles WHERE id = r.requested_by),
                    'preferred_tech_id', r.preferred_tech_id, 'preferred', (SELECT full_name FROM public.profiles WHERE id = r.preferred_tech_id),
                    'reason', r.reason, 'created_at', r.created_at) ORDER BY r.created_at)
                 FROM public.lead_reassign_requests r WHERE r.lead_id = l.id AND r.status = 'pending'), '[]'::jsonb)
                ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at)) FROM public.lead_reassign_requests r
                 WHERE r.lead_id = l.id AND r.status = 'pending' AND r.requested_by = v_uid), '[]'::jsonb) END);
END $$;

-- Job type(s) + information (office or sales of the lead's company). Used by Assign and on its own.
CREATE OR REPLACE FUNCTION public.save_lead_job_info(p_lead_id uuid, p_job_types text[], p_job_info text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; v_types text[];
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF l.id IS NULL OR v_uid IS NULL OR NOT (public._lead_office(v_uid, l.company_id)
       OR (public.is_sales_rep(v_uid) AND public.get_user_company_id(v_uid) = l.company_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Lead not found');
  END IF;
  SELECT array_agg(DISTINCT lower(x) ORDER BY lower(x)) INTO v_types FROM unnest(COALESCE(p_job_types, '{}')) x WHERE lower(x) IN ('service','repair','installation');
  UPDATE public.leads SET job_types = v_types, job_info = left(NULLIF(trim(p_job_info), ''), 4000) WHERE id = l.id;
  RETURN jsonb_build_object('ok', true);
END $$;

DROP FUNCTION IF EXISTS public.assign_lead_to_tech(uuid, uuid, date, time, time);
-- Same writes as the admin Assign dialog for a lead (job_schedules lead row + leads.assigned_agent_id/date/time/method).
CREATE OR REPLACE FUNCTION public.assign_lead_to_tech(p_lead_id uuid, p_tech_id uuid, p_date date, p_start time, p_end time,
  p_job_types text[] DEFAULT NULL, p_job_info text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; v_office boolean; v_sales boolean; v_sched uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 401, 'message', 'Sign in first'); END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead_id AND deleted_at IS NULL AND merged_into_id IS NULL FOR UPDATE;
  IF l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Lead not found'); END IF;
  v_office := public._lead_office(v_uid, l.company_id);
  v_sales := NOT v_office AND public.is_sales_rep(v_uid) AND public.get_user_company_id(v_uid) = l.company_id;
  IF NOT (v_office OR v_sales) THEN RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Lead not found'); END IF;
  IF v_sales AND l.assigned_agent_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'This lead already has someone. Request a reassignment instead.');
  END IF;
  IF l.primary_intent IS DISTINCT FROM 'service' THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Only service leads are assigned to technicians here.');
  END IF;
  IF NOT public._company_tech_ok(p_tech_id, l.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That technician is not in this company');
  END IF;
  IF p_date IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN jsonb_build_object('ok', false, 'code', 400, 'message', 'Pick a date and a valid time');
  END IF;
  IF p_date < (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RETURN jsonb_build_object('ok', false, 'code', 400, 'message', 'Pick today or a later date');
  END IF;

  SELECT id INTO v_sched FROM public.job_schedules WHERE lead_id = l.id AND job_id IS NULL ORDER BY created_at LIMIT 1;
  IF v_sched IS NOT NULL THEN
    UPDATE public.job_schedules SET agent_id = p_tech_id, scheduled_date = p_date, start_time = p_start, end_time = p_end WHERE id = v_sched;
  ELSE
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time)
    VALUES (l.id, NULL, p_tech_id, p_date, p_start, p_end);
  END IF;
  UPDATE public.leads SET assigned_agent_id = p_tech_id, scheduled_date = p_date, scheduled_time = p_start,
         assignment_method = 'manual_dispatch' WHERE id = l.id;
  IF p_job_types IS NOT NULL OR p_job_info IS NOT NULL THEN
    PERFORM public.save_lead_job_info(l.id, COALESCE(p_job_types, l.job_types), COALESCE(p_job_info, l.job_info));
  END IF;

  INSERT INTO public.lead_assignment_log (lead_id, company_id, tech_id, previous_agent_id, assigned_by, by_role, scheduled_date, start_time, end_time)
  VALUES (l.id, l.company_id, p_tech_id, l.assigned_agent_id, v_uid, CASE WHEN v_office THEN 'office' ELSE 'sales' END, p_date, p_start, p_end);

  IF v_office THEN
    UPDATE public.lead_reassign_requests SET status = 'approved', resolved_by = v_uid, resolved_at = now()
     WHERE lead_id = l.id AND status = 'pending';
  END IF;
  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'tech_id', p_tech_id);
END $$;

CREATE OR REPLACE FUNCTION public.request_lead_reassignment(p_lead_id uuid, p_preferred_tech_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF l.id IS NULL OR v_uid IS NULL OR public.get_user_company_id(v_uid) IS DISTINCT FROM l.company_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Lead not found');
  END IF;
  IF l.assigned_agent_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Lead is unassigned. Assign it instead.'); END IF;
  IF p_preferred_tech_id IS NOT NULL AND NOT public._company_tech_ok(p_preferred_tech_id, l.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That technician is not in this company');
  END IF;
  INSERT INTO public.lead_reassign_requests (lead_id, company_id, requested_by, preferred_tech_id, reason)
  VALUES (l.id, l.company_id, v_uid, p_preferred_tech_id, left(NULLIF(trim(p_reason), ''), 500));
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'You already asked for a reassignment on this lead');
END $$;

CREATE OR REPLACE FUNCTION public.decline_lead_reassignment(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.lead_reassign_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.lead_reassign_requests WHERE id = p_request_id;
  IF r.id IS NULL OR NOT public._lead_office(auth.uid(), r.company_id) THEN RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Request not found'); END IF;
  UPDATE public.lead_reassign_requests SET status = 'declined', resolved_by = auth.uid(), resolved_at = now() WHERE id = r.id AND status = 'pending';
  RETURN jsonb_build_object('ok', true);
END $$;

-- Office list of pending requests (Jobs page banner).
CREATE OR REPLACE FUNCTION public.pending_reassign_requests()
RETURNS TABLE(id uuid, lead_id uuid, customer_name text, requested_by_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id, r.lead_id, l.customer_name, p.full_name, r.created_at
    FROM public.lead_reassign_requests r JOIN public.leads l ON l.id = r.lead_id
    LEFT JOIN public.profiles p ON p.id = r.requested_by
   WHERE r.status = 'pending' AND public._lead_office(auth.uid(), r.company_id)
   ORDER BY r.created_at;
$$;

REVOKE ALL ON FUNCTION public._lead_office(uuid, uuid), public._company_tech_ok(uuid, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.lead_assign_options(uuid, date), public.assign_lead_to_tech(uuid, uuid, date, time, time, text[], text), public.save_lead_job_info(uuid, text[], text),
  public.request_lead_reassignment(uuid, uuid, text), public.decline_lead_reassignment(uuid), public.pending_reassign_requests() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.lead_assign_options(uuid, date), public.assign_lead_to_tech(uuid, uuid, date, time, time, text[], text), public.save_lead_job_info(uuid, text[], text),
  public.request_lead_reassignment(uuid, uuid, text), public.decline_lead_reassignment(uuid), public.pending_reassign_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public._lead_office(uuid, uuid), public._company_tech_ok(uuid, uuid) TO authenticated;

-- Remote-quote photos: a sales rep may also add site photos to a lead they assigned through Assign
-- (existing private job-photos bucket + job_photos table; company scope unchanged).
CREATE OR REPLACE FUNCTION public.photo_lead_ok(_lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND _lead IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.company_id = public.caller_company_id())
    AND CASE
      WHEN public.is_field_tech_only(auth.uid()) THEN public.tech_owns_lead(auth.uid(), _lead)
      WHEN public.is_sales_rep(auth.uid()) THEN public.rep_owns_lead(auth.uid(), _lead)
        OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = auth.uid())
      ELSE public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'dispatcher'::app_role)
    END;
$function$;
