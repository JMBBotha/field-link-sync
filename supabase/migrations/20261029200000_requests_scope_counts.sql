-- Johan 29 Oct 18:14: rep saw "Not contacted 2h+ = 1" on Home but an empty list. Counts were company-wide, inbox rep-scoped.
-- One visibility rule + one "contacted" rule shared by requests_inbox and requests_today_counts.
-- Contacted = a logged contact, OR admin/office added it manually, OR it is already assigned/scheduled/has a job (contact happened outside the app).

CREATE OR REPLACE FUNCTION public.fl_request_visible(r public.requests, p_uid uuid, p_office boolean)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT p_office OR r.assigned_to = p_uid OR r.created_by = p_uid
    OR (r.status = 'open' AND r.assigned_to IS NULL AND (r.type IS NULL OR r.type IN ('new_sale','move')));
$$;

CREATE OR REPLACE FUNCTION public.fl_request_contacted(r public.requests)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT r.first_contact_at IS NOT NULL OR r.source = 'manual' OR r.assigned_to IS NOT NULL OR r.job_id IS NOT NULL OR r.scheduled_for IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.fl_request_red(r public.requests)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT r.status = 'open' AND NOT public.fl_request_contacted(r) AND public.fl_working_minutes(r.created_at, now()) > 120;
$$;

CREATE OR REPLACE FUNCTION public.requests_inbox(p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_office boolean; v_sales boolean; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_co := public.get_user_company_id(v_uid);
  v_office := public.fl_is_company_office(v_uid, v_co);
  v_sales := public.is_sales_rep(v_uid);
  IF NOT (v_office OR v_sales) THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'created_at') DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT CASE WHEN v_office OR r.assigned_to = v_uid OR r.created_by = v_uid THEN
      jsonb_build_object('id', r.id, 'masked', false, 'source', r.source, 'type', r.type, 'suggested_type', r.suggested_type, 'type_confidence', r.type_confidence,
        'sorted_by', r.sorted_by, 'sort_reason', r.sort_reason, 'status', r.status, 'customer_id', r.customer_id, 'lead_id', r.lead_id, 'job_id', r.job_id,
        'customer_name', r.customer_name, 'phone', r.phone, 'area', r.area, 'summary', r.summary, 'routed_to', r.routed_to,
        'assigned_to', r.assigned_to, 'assigned_name', (SELECT full_name FROM public.profiles WHERE id = r.assigned_to),
        'assigned_at', r.assigned_at, 'scheduled_for', r.scheduled_for, 'first_contact_at', r.first_contact_at, 'contact_channel', r.contact_channel,
        'contacted', public.fl_request_contacted(r),
        'task_due_at', r.task_due_at, 'done_at', r.done_at, 'created_at', r.created_at,
        'owner_rep_name', (SELECT p.full_name FROM public.customers c JOIN public.profiles p ON p.id = c.owner_rep_id WHERE c.id = r.customer_id),
        'mine', r.assigned_to = v_uid OR r.created_by = v_uid,
        'working_min_waiting', CASE WHEN NOT public.fl_request_contacted(r) THEN public.fl_working_minutes(r.created_at, now()) END,
        'not_contacted_red', public.fl_request_red(r),
        'unscheduled_nudge', r.status = 'open' AND r.type = 'service' AND r.assigned_to IS NULL AND r.job_id IS NULL AND now() - r.created_at > interval '24 hours',
        'task_overdue', r.status = 'open' AND r.type = 'admin' AND r.task_due_at IS NOT NULL AND now() > r.task_due_at)
    ELSE
      jsonb_build_object('id', r.id, 'masked', true, 'source', r.source, 'type', r.type, 'suggested_type', r.suggested_type, 'status', r.status,
        'area', r.area, 'created_at', r.created_at, 'mine', false, 'not_contacted_red', public.fl_request_red(r))
    END AS row
    FROM public.requests r
    WHERE r.company_id = v_co AND r.status <> 'archived' AND r.created_at > now() - make_interval(days => GREATEST(1, LEAST(p_days, 365)))
      AND public.fl_request_visible(r, v_uid, v_office)
  ) s;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.requests_today_counts()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_office boolean; v_day0 timestamptz; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_co := public.get_user_company_id(v_uid);
  v_office := public.fl_is_company_office(v_uid, v_co);
  IF NOT (v_office OR public.is_sales_rep(v_uid)) THEN RETURN NULL; END IF;
  v_day0 := (((now() AT TIME ZONE 'Africa/Johannesburg')::date)::timestamp AT TIME ZONE 'Africa/Johannesburg');
  WITH v AS (SELECT r.* FROM public.requests r WHERE r.company_id = v_co AND r.status <> 'archived'
               AND r.created_at > now() - interval '30 days' AND public.fl_request_visible(r, v_uid, v_office)),
       t AS (SELECT * FROM v WHERE created_at >= v_day0)
  SELECT jsonb_build_object(
    'in', (SELECT count(*) FROM t),
    'needs_sorting', (SELECT count(*) FROM v WHERE type IS NULL AND status = 'open'),
    'not_contacted_red', (SELECT count(*) FROM v WHERE public.fl_request_red(v::public.requests)),
    'mine_today', (SELECT count(*) FROM t WHERE assigned_to = v_uid OR created_by = v_uid),
    'types', (SELECT jsonb_object_agg(k, jsonb_build_object(
        'in', (SELECT count(*) FROM t WHERE t.type::text = k),
        'contacted', (SELECT count(*) FROM t WHERE t.type::text = k AND public.fl_request_contacted(t::public.requests)),
        'assigned', (SELECT count(*) FROM t WHERE t.type::text = k AND (t.assigned_to IS NOT NULL OR t.job_id IS NOT NULL OR t.scheduled_for IS NOT NULL OR t.status = 'done'))))
      FROM unnest(ARRAY['new_sale','service','move','admin']) k)
  ) INTO v_out;
  RETURN v_out;
END $function$;
