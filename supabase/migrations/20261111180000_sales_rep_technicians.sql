-- Preview only. Do not apply to the live database until the go-live steps in the PR are followed.
-- Salespeople book only the technicians an admin assigned to them.
-- Admins and office dispatchers are unchanged. New technicians are not auto-added.
--
-- Replaced RPCs (latest body, assignment predicate only):
--   public.dispatchable_technicians(uuid)
--   public._rank_core(text, date, time, integer, double precision, double precision, uuid, uuid)
--   public.lead_assign_options(uuid, date)
--   public.assign_lead_to_tech(uuid, uuid, date, time, time, text[], text)
--   public.request_lead_reassignment(uuid, uuid, text)
-- New:
--   public.sales_may_book_tech(uuid, uuid)
--   public.sales_profile_visible(uuid)
--   public.sales_schedule_row_visible(uuid, uuid, uuid)
--   public.srt_in_company(uuid, uuid)
--   public.srt_service_lane(uuid)
-- Policies added (none of the existing ones are replaced):
--   srt_rep_select, srt_admin_select, srt_admin_insert, srt_admin_delete  on sales_rep_technicians
--   srt_sales_profiles_select  on profiles (RESTRICTIVE SELECT)
--   srt_sales_sched_select     on job_schedules (RESTRICTIVE SELECT)
-- Left unchanged: dl_rep_assign_insert, dl_rep_sched_insert (and the other dl_rep_* writes),
-- agent_locations policies, job_tech_location.

CREATE TABLE IF NOT EXISTS public.sales_rep_technicians (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sales_rep_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, sales_rep_id, technician_id),
  CONSTRAINT sales_rep_technicians_distinct CHECK (sales_rep_id <> technician_id)
);

COMMENT ON TABLE public.sales_rep_technicians IS
  'Technicians a salesperson may see and book. Admin-maintained. No automatic row when a technician is added.';

CREATE INDEX IF NOT EXISTS sales_rep_technicians_rep_idx
  ON public.sales_rep_technicians (sales_rep_id, company_id);
CREATE INDEX IF NOT EXISTS sales_rep_technicians_tech_idx
  ON public.sales_rep_technicians (technician_id, company_id);

CREATE OR REPLACE FUNCTION public.srt_in_company(_uid uuid, _company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _uid IS NOT NULL AND _company IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.company_id = _company)
    OR public.is_company_member(_uid, _company)
    OR EXISTS (
      SELECT 1 FROM public.agent_affiliations a
      WHERE a.profile_id = _uid
        AND a.company_id = _company
        AND a.status = 'active'
        AND a.affiliation_type IN ('technical', 'both')
    )
  );
$$;

-- Service lane: technician dispatch role, or an independent tech. no_login is included (not excluded).
CREATE OR REPLACE FUNCTION public.srt_service_lane(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _uid
      AND p.archived_at IS NULL
      AND (
        p.dispatch_role = 'technician'
        OR p.participant_type = 'independent_tech'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.srt_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.srt_in_company(NEW.sales_rep_id, NEW.company_id)
     OR NOT public.srt_in_company(NEW.technician_id, NEW.company_id) THEN
    RAISE EXCEPTION 'Salesperson and technician must both belong to the company' USING ERRCODE = '23514';
  END IF;
  IF NOT public.is_sales_rep(NEW.sales_rep_id) THEN
    RAISE EXCEPTION 'That person is not a salesperson' USING ERRCODE = '23514';
  END IF;
  IF NOT public.srt_service_lane(NEW.technician_id) THEN
    RAISE EXCEPTION 'That person is not a service-lane technician' USING ERRCODE = '23514';
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_rep_technicians_guard ON public.sales_rep_technicians;
CREATE TRIGGER trg_sales_rep_technicians_guard
  BEFORE INSERT OR UPDATE ON public.sales_rep_technicians
  FOR EACH ROW EXECUTE FUNCTION public.srt_guard();

ALTER TABLE public.sales_rep_technicians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS srt_rep_select ON public.sales_rep_technicians;
CREATE POLICY srt_rep_select ON public.sales_rep_technicians
  FOR SELECT TO authenticated
  USING (sales_rep_id = auth.uid());

DROP POLICY IF EXISTS srt_admin_select ON public.sales_rep_technicians;
CREATE POLICY srt_admin_select ON public.sales_rep_technicians
  FOR SELECT TO authenticated
  USING (public.fl_is_company_admin(auth.uid(), company_id));

DROP POLICY IF EXISTS srt_admin_insert ON public.sales_rep_technicians;
CREATE POLICY srt_admin_insert ON public.sales_rep_technicians
  FOR INSERT TO authenticated
  WITH CHECK (public.fl_is_company_admin(auth.uid(), company_id));

DROP POLICY IF EXISTS srt_admin_delete ON public.sales_rep_technicians;
CREATE POLICY srt_admin_delete ON public.sales_rep_technicians
  FOR DELETE TO authenticated
  USING (public.fl_is_company_admin(auth.uid(), company_id));

REVOKE ALL ON public.sales_rep_technicians FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.sales_rep_technicians TO authenticated;

-- non-sales => true (admins and office dispatchers book anyone). sales => an assignment row in their company.
CREATE OR REPLACE FUNCTION public.sales_may_book_tech(_uid uuid, _tech uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _uid IS NULL OR NOT public.is_sales_rep(_uid) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.sales_rep_technicians s
      WHERE s.sales_rep_id = _uid
        AND s.technician_id = _tech
        AND s.company_id = public.get_user_company_id(_uid)
    )
  END;
$$;

-- Sales profile read: self, assigned technicians, and a technician already on a job or lead this rep can see.
CREATE OR REPLACE FUNCTION public.sales_profile_visible(_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NULL
    OR NOT public.is_sales_rep(auth.uid())
    OR _profile = auth.uid()
    OR (
      public.is_sales_rep(auth.uid())
      AND public.sales_may_book_tech(auth.uid(), _profile)
    )
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.profile_id = _profile
        AND COALESCE(a.status, '') NOT IN ('declined', 'cancelled', 'rejected')
        AND public.rep_booked_or_assigned_job(auth.uid(), a.job_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.job_schedules s
      WHERE s.agent_id = _profile
        AND (
          (s.job_id IS NOT NULL AND public.rep_booked_or_assigned_job(auth.uid(), s.job_id))
          OR (s.lead_id IS NOT NULL AND public.rep_booked_or_assigned_lead(auth.uid(), s.lead_id))
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.assigned_agent_id = _profile
        AND l.deleted_at IS NULL
        AND public.rep_booked_or_assigned_lead(auth.uid(), l.id)
    );
$$;

-- Day-wide job_schedules read for sales: own rows, visible jobs/leads, and assigned technicians' busy slots.
-- Busy times are enough. AppointmentPicker selects id, agent_id, start_time, end_time (no client columns).
-- _rank_core already labels other people's bookings "Busy" when the caller is not office.
CREATE OR REPLACE FUNCTION public.sales_schedule_row_visible(_agent uuid, _job uuid, _lead uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NULL
    OR NOT public.is_sales_rep(auth.uid())
    OR _agent IS NOT DISTINCT FROM auth.uid()
    OR (
      public.is_sales_rep(auth.uid())
      AND public.sales_may_book_tech(auth.uid(), _agent)
    )
    OR (_job IS NOT NULL AND public.rep_booked_or_assigned_job(auth.uid(), _job))
    OR (_lead IS NOT NULL AND public.rep_booked_or_assigned_lead(auth.uid(), _lead));
$$;

REVOKE ALL ON FUNCTION public.srt_in_company(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.srt_service_lane(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.srt_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_may_book_tech(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_profile_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_schedule_row_visible(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_may_book_tech(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_profile_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_schedule_row_visible(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS srt_sales_profiles_select ON public.profiles;
CREATE POLICY srt_sales_profiles_select ON public.profiles
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.sales_profile_visible(id));

DROP POLICY IF EXISTS srt_sales_sched_select ON public.job_schedules;
CREATE POLICY srt_sales_sched_select ON public.job_schedules
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.sales_schedule_row_visible(agent_id, job_id, lead_id));


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
    AND (public.staff_is_available(t.id) OR COALESCE((SELECT p.no_login FROM public.profiles p WHERE p.id = t.id), false))
    AND public.has_role(t.id, 'field_agent'::app_role)
    AND NOT public.has_role(t.id, 'admin'::app_role)
    AND NOT public.has_role(t.id, 'dispatcher'::app_role)
    AND NOT public.is_company_admin(t.id, _company_id)
    AND COALESCE((SELECT p.dispatch_role FROM public.profiles p WHERE p.id = t.id), 'technician') = 'technician'
    AND (
      auth.uid() IS NULL
      OR NOT public.is_sales_rep(auth.uid())
      OR public.sales_may_book_tech(auth.uid(), t.id)
    )
  ORDER BY t.id, t.pri;
$function$;

CREATE OR REPLACE FUNCTION public._rank_core(p_lane text, p_date date, p_start time, p_minutes int,
  p_lat double precision, p_lng double precision, p_exclude_job uuid, p_exclude_lead uuid)
RETURNS TABLE(profile_id uuid, full_name text, tier int, status text, km numeric, reason text, next_free time,
  booked_minutes int, work_start time, work_end time, blocks jsonb, best_start time, sort_key numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_company uuid := public.caller_company_id(); v_full boolean;
  v_m int := GREATEST(COALESCE(p_minutes, 60), 5);
  v_req int := CASE WHEN p_start IS NULL THEN NULL ELSE (extract(epoch FROM p_start) / 60)::int END;
  p record; w record; b jsonb; ws int; we int; v_booked int;
  nb record; prev record; v_base_lat double precision; v_base_lng double precision; v_base_label text;
  v_fit boolean; v_cand int; v_next int; v_km numeric; v_back numeric; v_sort numeric; v_last boolean;
  v_clash text;
BEGIN
  v_full := v_uid IS NULL OR public.has_role(v_uid, 'admin')
    OR (public.is_ops_user(v_uid) AND COALESCE((SELECT dispatch_role FROM public.profiles WHERE id = v_uid), '') <> 'sales');

  FOR p IN
    SELECT pr.id, pr.full_name, pr.start_from, pr.home_lat, pr.home_lng, pr.office_lat, pr.office_lng,
           hb.lat AS hb_lat, hb.lng AS hb_lng, hb.address AS hb_addr, c.office_lat AS c_lat, c.office_lng AS c_lng
    FROM public.profiles pr
    LEFT JOIN public.staff_home_bases hb ON hb.profile_id = pr.id
    LEFT JOIN public.companies c ON c.id = pr.company_id
    WHERE pr.company_id = v_company AND COALESCE(pr.dispatch_active, false) AND pr.archived_at IS NULL
      AND (
        v_full
        OR pr.id = v_uid
        OR (public.is_sales_rep(v_uid) AND p_lane IS DISTINCT FROM 'sales' AND public.sales_may_book_tech(v_uid, pr.id))
      )
      AND CASE WHEN p_lane = 'sales'
            THEN pr.dispatch_role = 'sales' AND COALESCE(pr.participant_type,'') <> 'independent_tech'
            ELSE pr.dispatch_role = 'technician' OR pr.participant_type = 'independent_tech' END
  LOOP
    SELECT * INTO w FROM public.staff_work_window(p.id, p_date);
    ws := (extract(epoch FROM w.start_time) / 60)::int; we := (extract(epoch FROM w.end_time) / 60)::int;

    v_base_lat := NULL; v_base_lng := NULL; v_base_label := NULL;
    IF COALESCE(p.start_from, 'home') = 'home' AND p.hb_lat IS NOT NULL THEN
      v_base_lat := p.hb_lat; v_base_lng := p.hb_lng;
      v_base_label := 'Home' || COALESCE(' (' || NULLIF(trim(split_part(p.hb_addr, ',', 2)), '') || ')', '');
    ELSIF COALESCE(p.start_from, '') <> 'office' AND p.home_lat IS NOT NULL THEN
      v_base_lat := p.home_lat; v_base_lng := p.home_lng; v_base_label := 'Home';
    ELSIF p.office_lat IS NOT NULL THEN
      v_base_lat := p.office_lat; v_base_lng := p.office_lng; v_base_label := 'Office';
    ELSIF p.c_lat IS NOT NULL THEN
      v_base_lat := p.c_lat; v_base_lng := p.c_lng; v_base_label := 'Office';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             's', (extract(epoch FROM q.start_time) / 60)::int,
             'e', (extract(epoch FROM q.end_time) / 60)::int,
             'pad', (q.job_id IS NOT NULL OR q.lead_id IS NOT NULL),
             'lat', q.lat, 'lng', q.lng, 'area', q.area,
             'label', CASE WHEN q.job_id IS NULL AND q.lead_id IS NULL THEN q.customer_name
                           WHEN v_full OR p.id = v_uid THEN COALESCE(q.customer_name, 'Booking') ELSE 'Busy' END,
             'km', CASE WHEN q.lat IS NULL OR p_lat IS NULL THEN NULL
                        ELSE round(public.calculate_distance_km(p_lat::numeric, p_lng::numeric, q.lat, q.lng), 1) END
           ) ORDER BY q.start_time), '[]'::jsonb)
      INTO b
    FROM (
      SELECT bk.*, COALESCE(l.latitude, j.lat, cu.latitude) AS lat, COALESCE(l.longitude, j.lng, cu.longitude) AS lng,
             COALESCE(NULLIF(trim(split_part(l.customer_address, ',', 2)), ''), cu.city) AS area
      FROM public._person_bookings(p.id, p_date) bk
      LEFT JOIN public.leads l ON l.id = bk.lead_id
      LEFT JOIN public.jobs j ON j.id = bk.job_id
      LEFT JOIN public.customers cu ON cu.id = COALESCE(j.customer_id, l.customer_id)
      WHERE (p_exclude_job IS NULL OR bk.job_id IS DISTINCT FROM p_exclude_job)
        AND (p_exclude_lead IS NULL OR bk.lead_id IS DISTINCT FROM p_exclude_lead)
    ) q;

    SELECT COALESCE(sum(GREATEST(0, (x->>'e')::int - (x->>'s')::int)), 0)::int INTO v_booked
      FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean;

    profile_id := p.id; full_name := p.full_name; booked_minutes := v_booked;
    work_start := w.start_time; work_end := w.end_time; best_start := NULL; next_free := NULL;
    blocks := (SELECT COALESCE(jsonb_agg(jsonb_build_object('start', to_char(public._mins_time((x->>'s')::int), 'HH24:MI'),
                'end', to_char(public._mins_time((x->>'e')::int), 'HH24:MI'), 'label', x->>'label')), '[]'::jsonb)
              FROM jsonb_array_elements(b) x);

    IF NOT w.is_working THEN
      tier := 3; status := CASE WHEN w.source = 'leave' THEN 'leave' ELSE 'off' END; km := NULL;
      reason := CASE WHEN w.source = 'leave' THEN 'On leave' ELSE 'Off today' END; sort_key := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    v_fit := v_req IS NOT NULL AND public._slot_fits(b, ws, we, v_req, v_m);

    SELECT (x->>'s')::int AS s, (x->>'e')::int AS e, (x->>'km')::numeric AS k, x->>'area' AS area INTO nb
      FROM jsonb_array_elements(b) x
      WHERE (x->>'pad')::boolean AND x->>'km' IS NOT NULL AND (x->>'km')::numeric <= 15
      ORDER BY (x->>'km')::numeric LIMIT 1;

    v_cand := NULL;
    IF nb.s IS NOT NULL AND (v_req IS NULL OR v_fit) THEN
      IF v_fit THEN v_cand := v_req;
      ELSIF public._slot_fits(b, ws, we, nb.e + 30, v_m) THEN v_cand := nb.e + 30;
      ELSIF public._slot_fits(b, ws, we, nb.s - 30 - v_m, v_m) THEN v_cand := nb.s - 30 - v_m;
      END IF;
    END IF;

    IF v_cand IS NOT NULL THEN
      tier := 1; status := 'free'; km := nb.k; sort_key := nb.k;
      best_start := public._mins_time(v_cand);
      next_free := CASE WHEN v_cand = v_req THEN NULL ELSE public._mins_time(v_cand) END;
      reason := 'Already in ' || COALESCE(nb.area, 'the area') || ' ' || to_char(public._mins_time(nb.s), 'HH24:MI') || '–'
        || to_char(public._mins_time(nb.e), 'HH24:MI') || ' · ' || nb.k || ' km'
        || CASE WHEN v_cand = v_req THEN '' ELSE ' · free from ' || to_char(public._mins_time(v_cand), 'HH24:MI') END;
      RETURN NEXT; CONTINUE;
    END IF;

    v_cand := CASE WHEN v_req IS NULL THEN public._first_fit(b, ws, we, ws, v_m) WHEN v_fit THEN v_req ELSE NULL END;
    IF v_cand IS NOT NULL THEN
      SELECT (x->>'e')::int AS e, (x->>'km')::numeric AS k INTO prev FROM jsonb_array_elements(b) x
        WHERE (x->>'pad')::boolean AND (x->>'e')::int <= v_cand AND x->>'lat' IS NOT NULL
        ORDER BY (x->>'e')::int DESC LIMIT 1;
      v_last := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b) x WHERE (x->>'pad')::boolean AND (x->>'s')::int >= v_cand + v_m);
      v_back := CASE WHEN v_base_lat IS NULL OR p_lat IS NULL THEN NULL
                     ELSE round(public.calculate_distance_km(p_lat::numeric, p_lng::numeric, v_base_lat::numeric, v_base_lng::numeric), 1) END;
      tier := 2; status := 'free'; best_start := public._mins_time(v_cand);
      IF prev.e IS NOT NULL THEN
        km := prev.k;
        reason := 'Free · ' || COALESCE(prev.k || ' km', 'no location') || ' from ' || to_char(public._mins_time(prev.e), 'HH24:MI') || ' job';
      ELSIF v_booked = 0 THEN
        km := v_back;
        reason := 'Empty day' || COALESCE(' · starts from ' || v_base_label, '') || COALESCE(' · ' || v_back || ' km', '');
      ELSE
        km := v_back;
        reason := 'Free' || COALESCE(' · ' || v_back || ' km from ' || v_base_label, '');
      END IF;
      IF v_req IS NULL THEN reason := reason || ' · free from ' || to_char(best_start, 'HH24:MI'); END IF;
      sort_key := km + CASE WHEN v_last AND v_back IS NOT NULL THEN v_back * 0.25 ELSE 0 END;
      RETURN NEXT; CONTINUE;
    END IF;

    tier := 3; status := 'busy'; km := NULL; sort_key := NULL;
    v_next := public._first_fit(b, ws, we, COALESCE(v_req, ws), v_m);
    next_free := CASE WHEN v_next IS NULL THEN NULL ELSE public._mins_time(v_next) END;
    SELECT CASE WHEN (x->>'pad')::boolean THEN 'Booked ' WHEN x->>'label' ILIKE '%leave%' OR x->>'label' ILIKE 'off%' THEN 'Off ' ELSE 'Blocked ' END
      || to_char(public._mins_time((x->>'s')::int), 'HH24:MI') || '–' || to_char(public._mins_time((x->>'e')::int), 'HH24:MI')
      INTO v_clash FROM jsonb_array_elements(b) x
      WHERE v_req IS NOT NULL AND (x->>'s')::int < v_req + v_m + 30 AND (x->>'e')::int + 30 > v_req
      ORDER BY (x->>'s')::int LIMIT 1;
    reason := CASE WHEN v_clash IS NOT NULL THEN v_clash
                   WHEN v_req IS NOT NULL AND (v_req < ws OR v_req + v_m > we) THEN 'Outside hours ' || to_char(w.start_time,'HH24:MI') || '–' || to_char(w.end_time,'HH24:MI')
                   ELSE 'Fully booked' END
      || CASE WHEN v_next IS NOT NULL THEN ' · next free ' || to_char(public._mins_time(v_next), 'HH24:MI') ELSE '' END;
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._rank_core(text, date, time, int, double precision, double precision, uuid, uuid) FROM PUBLIC, anon, authenticated;

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
         WHERE cm.company_id = l.company_id AND public._company_tech_ok(p.id, l.company_id)
           AND (NOT v_sales OR public.sales_may_book_tech(v_uid, p.id))) s), '[]'::jsonb),
    'requests', CASE WHEN v_office THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'by', (SELECT full_name FROM public.profiles WHERE id = r.requested_by),
                    'preferred_tech_id', r.preferred_tech_id, 'preferred', (SELECT full_name FROM public.profiles WHERE id = r.preferred_tech_id),
                    'reason', r.reason, 'created_at', r.created_at) ORDER BY r.created_at)
                 FROM public.lead_reassign_requests r WHERE r.lead_id = l.id AND r.status = 'pending'), '[]'::jsonb)
                ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at)) FROM public.lead_reassign_requests r
                 WHERE r.lead_id = l.id AND r.status = 'pending' AND r.requested_by = v_uid), '[]'::jsonb) END);
END $$;

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
  IF v_sales AND NOT public.sales_may_book_tech(v_uid, p_tech_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That technician is not assigned to you');
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
  IF p_preferred_tech_id IS NOT NULL AND public.is_sales_rep(v_uid) AND NOT public.sales_may_book_tech(v_uid, p_preferred_tech_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That technician is not assigned to you');
  END IF;
  INSERT INTO public.lead_reassign_requests (lead_id, company_id, requested_by, preferred_tech_id, reason)
  VALUES (l.id, l.company_id, v_uid, p_preferred_tech_id, left(NULLIF(trim(p_reason), ''), 500));
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'You already asked for a reassignment on this lead');
END $$;

-- One-off seed at migrate time. Johan Sales gets every Massair CT service-lane technician
-- that exists now (today that is Innocent 09a7f5af-2752-4835-8738-54f7b53083ea, plus anyone
-- else already on the service lane, including a no-login technician). Almari (f7503c66…) is
-- not in this list and receives none. Nothing here runs again when a technician is added later.
INSERT INTO public.sales_rep_technicians (company_id, sales_rep_id, technician_id)
SELECT v.company_id, v.sales_rep_id, p.id
FROM (VALUES (
  '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid,
  '420c7731-e8a4-4355-80ca-51c684b42a2c'::uuid
)) AS v(company_id, sales_rep_id)
JOIN public.profiles p ON true
WHERE public.is_sales_rep(v.sales_rep_id)
  AND public.srt_in_company(v.sales_rep_id, v.company_id)
  AND public.srt_in_company(p.id, v.company_id)
  AND public.srt_service_lane(p.id)
  AND p.id <> v.sales_rep_id
ON CONFLICT DO NOTHING;
