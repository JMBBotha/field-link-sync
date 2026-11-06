-- Salesperson sees jobs they booked or are assigned to, including a technician's installation.
-- One rule for the Jobs list (sales_schedule_scope), Home → My jobs (sales_my_jobs),
-- and the per-job on-the-way map (fl_is_job_salesperson → job_tech_location).
--
-- Booked (this profile id only — a second login is a different person):
--   jobs.created_by
--   assignments.assigned_by                         who handed the job to a technician
--   leads.created_by
--   lead_assignment_log.assigned_by
--   quotes.created_by                               job quote, variation quote, or a quote on the lead
-- Assigned:
--   assignments.profile_id                          live row only (not declined / cancelled / rejected)
--   job_schedules.agent_id
--   leads.assigned_agent_id
--   quotes.sales_engineer_id, quotes.owner_id       same quote set
--   customers.assigned_rep_id, customers.owner_rep_id
--
-- Company admin keeps the existing map (fl_is_company_admin). Does not grant a company-wide staff location read.
-- Availability Off does not hide or unschedule anything here.
-- Not applied by this commit; ship with the app change.

CREATE OR REPLACE FUNCTION public.rep_booked_or_assigned_job(_uid uuid, _job uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _job IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.jobs j
    LEFT JOIN public.customers c
      ON c.id = j.customer_id AND c.company_id = j.company_id
    WHERE j.id = _job
      AND j.company_id = public.get_user_company_id(_uid)
      AND (
        j.created_by = _uid
        OR c.assigned_rep_id = _uid
        OR c.owner_rep_id = _uid
        OR EXISTS (
          SELECT 1 FROM public.assignments a
          WHERE a.job_id = j.id
            AND (
              a.assigned_by = _uid
              OR (
                a.profile_id = _uid
                AND COALESCE(a.status, '') NOT IN ('declined', 'cancelled', 'rejected')
              )
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.job_schedules s
          WHERE s.job_id = j.id AND s.agent_id = _uid
        )
        OR EXISTS (
          SELECT 1 FROM public.quotes q
          WHERE (q.company_id IS NULL OR q.company_id = j.company_id)
            AND (
              q.id = j.quote_id
              OR q.id = j.variation_quote_id
              OR (j.lead_id IS NOT NULL AND q.lead_id = j.lead_id)
            )
            AND _uid IN (q.sales_engineer_id, q.owner_id, q.created_by)
        )
        OR EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.id = j.lead_id
            AND l.company_id = j.company_id
            AND l.deleted_at IS NULL
            AND (
              _uid IN (l.assigned_agent_id, l.created_by)
              OR EXISTS (
                SELECT 1 FROM public.lead_assignment_log g
                WHERE g.lead_id = l.id AND g.company_id = l.company_id AND g.assigned_by = _uid
              )
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.rep_booked_or_assigned_lead(_uid uuid, _lead uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _lead IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.leads l
    LEFT JOIN public.customers c
      ON c.id = l.customer_id AND c.company_id = l.company_id
    WHERE l.id = _lead
      AND l.deleted_at IS NULL
      AND l.company_id = public.get_user_company_id(_uid)
      AND (
        _uid IN (l.assigned_agent_id, l.created_by)
        OR c.assigned_rep_id = _uid
        OR c.owner_rep_id = _uid
        OR EXISTS (
          SELECT 1 FROM public.lead_assignment_log g
          WHERE g.lead_id = l.id AND g.company_id = l.company_id AND g.assigned_by = _uid
        )
        OR EXISTS (
          SELECT 1 FROM public.quotes q
          WHERE q.lead_id = l.id
            AND (q.company_id IS NULL OR q.company_id = l.company_id)
            AND _uid IN (q.sales_engineer_id, q.owner_id, q.created_by)
        )
        OR EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.lead_id = l.id AND j.company_id = l.company_id
            AND public.rep_booked_or_assigned_job(_uid, j.id)
        )
      )
  );
$$;

-- Jobs page date window for the signed-in sales rep. Dates are Johannesburg calendar days, p_to exclusive.
CREATE OR REPLACE FUNCTION public.sales_schedule_scope(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_co uuid;
  v_to date;
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_rep(v_uid) OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RETURN jsonb_build_object('job_ids', '[]'::jsonb, 'lead_ids', '[]'::jsonb);
  END IF;
  v_to := LEAST(p_to, p_from + 62);
  v_co := public.get_user_company_id(v_uid);
  RETURN jsonb_build_object(
    'job_ids', COALESCE((
      SELECT jsonb_agg(DISTINCT j.id)
      FROM public.jobs j
      WHERE j.company_id = v_co
        AND public.rep_booked_or_assigned_job(v_uid, j.id)
        AND (
          (j.scheduled_for >= (p_from::timestamp AT TIME ZONE 'Africa/Johannesburg')
           AND j.scheduled_for < (v_to::timestamp AT TIME ZONE 'Africa/Johannesburg'))
          OR EXISTS (
            SELECT 1 FROM public.job_schedules s
            WHERE s.job_id = j.id AND s.scheduled_date >= p_from AND s.scheduled_date < v_to
          )
        )
    ), '[]'::jsonb),
    'lead_ids', COALESCE((
      SELECT jsonb_agg(DISTINCT l.id)
      FROM public.leads l
      WHERE l.company_id = v_co
        AND l.deleted_at IS NULL
        AND public.rep_booked_or_assigned_lead(v_uid, l.id)
        AND (
          (l.scheduled_date >= p_from AND l.scheduled_date < v_to)
          OR EXISTS (
            SELECT 1 FROM public.job_schedules s
            WHERE s.lead_id = l.id AND s.scheduled_date >= p_from AND s.scheduled_date < v_to
          )
        )
    ), '[]'::jsonb)
  );
END $$;

-- Map access: admin of the job's company (as before), or a sales rep who booked or is assigned.
-- A technician assignment alone does not open this. A linked admin login is not treated as this profile.
CREATE OR REPLACE FUNCTION public.fl_is_job_salesperson(_uid uuid, _job uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job
      AND j.company_id = public.get_user_company_id(_uid)
      AND (
        public.fl_is_company_admin(_uid, j.company_id)
        OR (public.is_sales_rep(_uid) AND public.rep_booked_or_assigned_job(_uid, j.id))
      )
  );
$$;

-- Home → My jobs. A job the rep booked stays visible even when the lead's assigned_agent_id
-- is still that salesperson (the previous query skipped those rows).
CREATE OR REPLACE FUNCTION public.sales_my_jobs(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_limit int;
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_rep(v_uid) THEN RETURN '[]'::jsonb; END IF;
  v_co := public.get_user_company_id(v_uid);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'sort') DESC)
    FROM (
      SELECT x FROM (
        SELECT jsonb_build_object(
          'lead_id', l.id,
          'job_id', j.id,
          'customer', COALESCE(l.customer_name, c.name),
          'title', COALESCE(j.title, l.service_type),
          'tech_name', p.full_name,
          'tech_status', COALESCE(p.availability_status, 'offline'),
          'scheduled_date', COALESCE((j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date, l.scheduled_date),
          'scheduled_time', COALESCE(to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'), left(l.scheduled_time::text, 5)),
          'stage', public._job_stage(j, l),
          'job_status', COALESCE(j.status::text, l.status),
          'job_types', l.job_types,
          'job_info', l.job_info,
          'photos', CASE WHEN l.id IS NULL THEN 0 ELSE (SELECT count(*) FROM public.job_photos ph WHERE ph.lead_id = l.id) END,
          'sort', COALESCE(j.updated_at, j.created_at)
        ) AS x
        FROM public.jobs j
        LEFT JOIN public.leads l ON l.id = j.lead_id AND l.deleted_at IS NULL
        LEFT JOIN public.customers c ON c.id = j.customer_id
        LEFT JOIN public.profiles p ON p.id = COALESCE(
          (SELECT s.agent_id FROM public.job_schedules s
            WHERE s.job_id = j.id AND s.agent_id IS NOT NULL
            ORDER BY s.scheduled_date DESC, s.start_time DESC NULLS LAST LIMIT 1),
          (SELECT a.profile_id FROM public.assignments a
            WHERE a.job_id = j.id AND COALESCE(a.status, '') NOT IN ('declined', 'cancelled', 'rejected')
            ORDER BY a.created_at DESC LIMIT 1),
          l.assigned_agent_id)
        WHERE j.company_id = v_co
          AND COALESCE(j.status, '') NOT IN ('cancelled', 'canceled')
          AND public.rep_booked_or_assigned_job(v_uid, j.id)

        UNION ALL

        SELECT jsonb_build_object(
          'lead_id', l.id,
          'job_id', NULL,
          'customer', l.customer_name,
          'title', l.service_type,
          'tech_name', p.full_name,
          'tech_status', COALESCE(p.availability_status, 'offline'),
          'scheduled_date', l.scheduled_date,
          'scheduled_time', left(l.scheduled_time::text, 5),
          'stage', public._job_stage(NULL::public.jobs, l),
          'job_status', l.status,
          'job_types', l.job_types,
          'job_info', l.job_info,
          'photos', (SELECT count(*) FROM public.job_photos ph WHERE ph.lead_id = l.id),
          'sort', l.created_at
        )
        FROM public.leads l
        LEFT JOIN public.profiles p ON p.id = l.assigned_agent_id
        WHERE l.company_id = v_co
          AND l.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.lead_id = l.id AND jj.company_id = l.company_id)
          AND l.assigned_agent_id IS NOT NULL
          AND l.assigned_agent_id <> v_uid
          AND public.rep_booked_or_assigned_lead(v_uid, l.id)
      ) listed
      ORDER BY (x->>'sort') DESC
      LIMIT v_limit
    ) capped
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.rep_booked_or_assigned_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rep_booked_or_assigned_lead(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_schedule_scope(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fl_is_job_salesperson(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_my_jobs(int) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sales_schedule_scope(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_my_jobs(int) TO authenticated;
