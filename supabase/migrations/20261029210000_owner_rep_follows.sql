-- Johan 29 Oct (t1899u/t1900u, 18:38): a salesperson stays in the loop on their clients' jobs whether they or admin scheduled them.
-- A sales rep now also follows any lead/request whose customer's owner_rep_id is that rep (same company only).
-- Customers with another rep or no rep are unaffected. fl_can_see_job and sales_my_jobs pick this up via rep_follows_lead.

CREATE OR REPLACE FUNCTION public.fl_rep_owns_customer(_uid uuid, _customer uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _customer IS NOT NULL AND public.is_sales_rep(_uid)
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer AND c.owner_rep_id = _uid
                AND c.company_id = _company AND c.company_id = public.get_user_company_id(_uid));
$$;

CREATE OR REPLACE FUNCTION public.rep_follows_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND _lead IS NOT NULL AND (
    public.rep_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = _uid)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND public.fl_rep_owns_customer(_uid, l.customer_id, l.company_id)));
$function$;

CREATE OR REPLACE FUNCTION public.fl_request_visible(r public.requests, p_uid uuid, p_office boolean)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT p_office OR r.assigned_to = p_uid OR r.created_by = p_uid
    OR public.fl_rep_owns_customer(p_uid, r.customer_id, r.company_id)
    OR (r.status = 'open' AND r.assigned_to IS NULL AND (r.type IS NULL OR r.type IN ('new_sale','move')));
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
    SELECT CASE WHEN v_office OR r.assigned_to = v_uid OR r.created_by = v_uid OR public.fl_rep_owns_customer(v_uid, r.customer_id, r.company_id) THEN
      jsonb_build_object('id', r.id, 'masked', false, 'source', r.source, 'type', r.type, 'suggested_type', r.suggested_type, 'type_confidence', r.type_confidence,
        'sorted_by', r.sorted_by, 'sort_reason', r.sort_reason, 'status', r.status, 'customer_id', r.customer_id, 'lead_id', r.lead_id, 'job_id', r.job_id,
        'customer_name', r.customer_name, 'phone', r.phone, 'area', r.area, 'summary', r.summary, 'routed_to', r.routed_to,
        'assigned_to', r.assigned_to, 'assigned_name', (SELECT full_name FROM public.profiles WHERE id = r.assigned_to),
        'assigned_at', r.assigned_at, 'scheduled_for', r.scheduled_for, 'first_contact_at', r.first_contact_at, 'contact_channel', r.contact_channel,
        'contacted', public.fl_request_contacted(r),
        'task_due_at', r.task_due_at, 'done_at', r.done_at, 'created_at', r.created_at,
        'owner_rep_name', (SELECT p.full_name FROM public.customers c JOIN public.profiles p ON p.id = c.owner_rep_id WHERE c.id = r.customer_id),
        'mine', r.assigned_to = v_uid OR r.created_by = v_uid OR public.fl_rep_owns_customer(v_uid, r.customer_id, r.company_id),
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

