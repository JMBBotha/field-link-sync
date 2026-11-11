-- Cancel a booked visit without closing the lead, touching quotes, or raising an invoice.
-- set_booking_visits is the 1 Nov body with the empty-list guard removed, so a cancelled visit can leave no rows.
-- booking_edit_perms is the 31 Oct body plus an office flag for a dispatcher who is not a salesperson.

CREATE OR REPLACE FUNCTION public.booking_edit_perms(p_lead uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; v_admin boolean; v_rep boolean;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF v_uid IS NULL OR NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RETURN jsonb_build_object('admin', false, 'rep', false, 'office', false, 'view', false); END IF;
  v_admin := COALESCE(public.fl_job_admin_ok(v_uid, l.company_id), false);
  v_rep := COALESCE(public.rep_owns_lead(v_uid, p_lead), false)
    OR (l.customer_id IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, l.customer_id, l.company_id), false));
  RETURN jsonb_build_object('admin', v_admin, 'rep', v_rep,
    'office', COALESCE(public.is_office_staff(v_uid), false) AND NOT COALESCE(public.is_sales_rep(v_uid), false),
    'view', v_admin OR v_rep OR NOT COALESCE(public.is_sales_rep(v_uid), false));
END $function$;

-- Cancel the visit on a booking (lead, no live job) or on a real job.
-- Booking: delete the lead's schedule rows and clear assigned_agent_id, scheduled_date, scheduled_time.
-- The lead stays open (status and lead_status unchanged). Quotes, including followup_state, are not written.
-- Job: status becomes cancelled. No call-out fee and no invoice row is created. close_lead is not called.
CREATE OR REPLACE FUNCTION public.cancel_booking_visit(
  p_lead uuid,
  p_reason text,
  p_note text DEFAULT NULL,
  p_job uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  l public.leads%ROWTYPE;
  j public.jobs%ROWTYPE;
  v_lead uuid := p_lead;
  v_company uuid;
  v_customer uuid;
  v_admin boolean;
  v_office boolean;
  v_own boolean;
  v_label text;
  v_note text;
  v_old_agent uuid;
  v_old_date date;
  v_old_time time;
  v_old_status text;
  v_n int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  v_label := CASE lower(regexp_replace(trim(coalesce(p_reason, '')), '\s+', ' ', 'g'))
    WHEN 'cancelled by client' THEN 'Cancelled by client'
    WHEN 'cancelled_by_client' THEN 'Cancelled by client'
    WHEN 'no longer needed' THEN 'No longer needed'
    WHEN 'no_longer_needed' THEN 'No longer needed'
    WHEN 'no-show' THEN 'No-show'
    WHEN 'no_show' THEN 'No-show'
    WHEN 'no show' THEN 'No-show'
    ELSE NULL END;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'Pick a reason: cancelled by client, no longer needed, or no-show';
  END IF;
  v_note := nullif(trim(coalesce(p_note, '')), '');

  IF p_job IS NOT NULL THEN
    SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
    IF NOT FOUND OR j.company_id IS DISTINCT FROM public.caller_company_id() THEN
      RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501'; END IF;
    IF j.status = 'completed' THEN RAISE EXCEPTION 'A completed job stays on the record'; END IF;
    IF v_lead IS NULL THEN v_lead := j.lead_id; END IF;
    IF j.lead_id IS NOT NULL AND v_lead IS DISTINCT FROM j.lead_id THEN
      RAISE EXCEPTION 'That visit is not on this job'; END IF;
    v_company := j.company_id;
    v_customer := j.customer_id;
    v_old_status := j.status;
    IF EXISTS (
      SELECT 1 FROM public.invoices i
       WHERE i.job_id = p_job AND coalesce(lower(i.status), '') NOT IN ('void', 'cancelled', 'canceled')
    ) THEN
      RAISE EXCEPTION 'This job already has an invoice';
    END IF;
  END IF;

  IF v_lead IS NOT NULL THEN
    SELECT * INTO l FROM public.leads WHERE id = v_lead FOR UPDATE;
    IF NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN
      RAISE EXCEPTION 'Booking not found' USING ERRCODE = '42501'; END IF;
    v_company := l.company_id;
    v_customer := COALESCE(v_customer, l.customer_id);
    v_old_agent := l.assigned_agent_id;
    v_old_date := l.scheduled_date;
    v_old_time := l.scheduled_time;
  END IF;
  IF v_company IS NULL OR v_company IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = '42501'; END IF;

  v_admin := COALESCE(public.fl_job_admin_ok(v_uid, v_company), false);
  v_office := COALESCE(public.is_office_staff(v_uid), false) AND NOT COALESCE(public.is_sales_rep(v_uid), false);
  v_own := COALESCE(public.is_sales_rep(v_uid), false) AND (
    (v_lead IS NOT NULL AND COALESCE(public.rep_owns_lead(v_uid, v_lead), false))
    OR (v_customer IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, v_customer, v_company), false))
  );
  IF NOT (v_admin OR v_office OR v_own) THEN
    RAISE EXCEPTION 'You can''t cancel this visit' USING ERRCODE = '42501'; END IF;

  IF p_job IS NULL AND EXISTS (
    SELECT 1 FROM public.jobs j2
     WHERE j2.lead_id = v_lead AND j2.status NOT IN ('cancelled', 'canceled')
  ) THEN
    RAISE EXCEPTION 'This booking is a job now — cancel it on the job page';
  END IF;

  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_admin_action', '1', true);

  WITH d AS (
    DELETE FROM public.job_schedules s
     WHERE (v_lead IS NOT NULL AND s.lead_id = v_lead AND (s.job_id IS NULL OR s.job_id IS NOT DISTINCT FROM p_job))
        OR (p_job IS NOT NULL AND s.job_id = p_job)
    RETURNING s.id
  )
  SELECT count(*) INTO v_n FROM d;

  IF p_job IS NOT NULL THEN
    IF j.status IS DISTINCT FROM 'cancelled' THEN
      UPDATE public.jobs
         SET status = 'cancelled', scheduled_for = NULL, scheduled_until = NULL, updated_at = now()
       WHERE id = p_job;
      -- A cancel trigger can hand future visits back to the lead. Drop those too. Do not insert an invoice.
      DELETE FROM public.job_schedules s
       WHERE s.job_id = p_job OR (v_lead IS NOT NULL AND s.lead_id = v_lead AND s.job_id IS NULL);
      INSERT INTO public.job_activity_log(job_id, user_id, action, details)
      VALUES (p_job, v_uid, 'visit_cancelled', jsonb_build_object(
        'reason', v_label, 'note', v_note, 'invoice', false, 'call_out', false));
    END IF;
  END IF;

  IF v_lead IS NOT NULL THEN
    UPDATE public.leads
       SET assigned_agent_id = NULL, scheduled_date = NULL, scheduled_time = NULL
     WHERE id = v_lead;
  END IF;

  INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES (
    CASE WHEN p_job IS NULL THEN 'leads' ELSE 'jobs' END,
    COALESCE(p_job, v_lead),
    'update',
    jsonb_build_object('assigned_agent_id', v_old_agent, 'scheduled_date', v_old_date, 'scheduled_time', v_old_time, 'status', v_old_status),
    jsonb_build_object('event', 'cancel_booking_visit', 'reason', v_label, 'note', v_note, 'schedules_cleared', v_n, 'invoice', false, 'call_out', false),
    v_uid, v_company);

  PERFORM set_config('app.backfill', '', true);
  PERFORM set_config('app.job_admin_action', '', true);
  RETURN jsonb_build_object('ok', true, 'reason', v_label, 'schedules_cleared', v_n, 'invoice', false,
    'job_status', CASE WHEN p_job IS NULL THEN NULL ELSE 'cancelled' END);
END $function$;

REVOKE ALL ON FUNCTION public.cancel_booking_visit(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking_visit(uuid, text, text, uuid) TO authenticated;

-- One salesperson for every live option in the quote's group. Other quote columns stay as they are.
CREATE OR REPLACE FUNCTION public.set_quote_group_salesperson(p_quote uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  q public.quotes%ROWTYPE;
  r record;
  v_ids jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_user IS NULL THEN RAISE EXCEPTION 'Pick a salesperson'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = p_quote FOR UPDATE;
  IF NOT FOUND OR q.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Quote not found' USING ERRCODE = '42501'; END IF;
  IF COALESCE(public.is_sales_rep(v_uid), false) AND NOT COALESCE(public.fl_job_admin_ok(v_uid, q.company_id), false) THEN
    RAISE EXCEPTION 'You can''t change the salesperson' USING ERRCODE = '42501'; END IF;
  IF NOT (COALESCE(public.fl_job_admin_ok(v_uid, q.company_id), false) OR COALESCE(public.is_office_staff(v_uid), false)) THEN
    RAISE EXCEPTION 'You can''t change the salesperson' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND p.company_id = q.company_id) THEN
    RAISE EXCEPTION 'Pick a salesperson in this company'; END IF;

  FOR r IN
    SELECT id, sales_engineer_id FROM public.quotes
     WHERE company_id = q.company_id AND archived_at IS NULL
       AND (id = q.id OR (q.option_group_id IS NOT NULL AND option_group_id = q.option_group_id))
     FOR UPDATE
  LOOP
    IF r.sales_engineer_id IS DISTINCT FROM p_user THEN
      UPDATE public.quotes SET sales_engineer_id = p_user WHERE id = r.id;
      INSERT INTO public.status_change_log(entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
      VALUES ('quote', r.id, 'sales_engineer_id', r.sales_engineer_id::text, p_user::text, v_uid, q.company_id);
      v_ids := v_ids || jsonb_build_array(r.id);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'option_group_id', q.option_group_id, 'updated', v_ids, 'count', jsonb_array_length(v_ids));
END $function$;

REVOKE ALL ON FUNCTION public.set_quote_group_salesperson(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_quote_group_salesperson(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_booking_visits(p_lead uuid, p_visits jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; p jsonb; v_admin boolean; v jsonb; s public.job_schedules%ROWTYPE;
  v_n int; v_keep uuid[] := '{}'; v_old jsonb; v_new jsonb; v_tech uuid; v_d date; v_st time; v_en time; v_total int := 0; i int := 0; v_first record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = p_lead AND j.status NOT IN ('cancelled','canceled')) THEN
    RAISE EXCEPTION 'This booking is a job now — add visits on the job page'; END IF;
  p := public.booking_edit_perms(p_lead); v_admin := (p->>'admin')::boolean;
  IF NOT (v_admin OR (p->>'rep')::boolean) THEN RAISE EXCEPTION 'You can''t edit this booking' USING ERRCODE='42501'; END IF;
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' THEN RAISE EXCEPTION 'Add at least one visit'; END IF;
  v_n := jsonb_array_length(p_visits);
  IF v_n > 130 THEN RAISE EXCEPTION 'At most 130 visits'; END IF;
  IF (SELECT count(DISTINCT x->>'date') FROM jsonb_array_elements(p_visits) x) <> v_n THEN RAISE EXCEPTION 'Two visits on the same day — combine them or pick another date'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_old FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL;
  IF NOT v_admin AND EXISTS (SELECT 1 FROM public.job_schedules s2 WHERE s2.lead_id = p_lead AND s2.job_id IS NULL
       AND s2.id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_visits) x WHERE x->>'id' IS NOT NULL)) THEN
    RAISE EXCEPTION 'Only an admin can remove visits' USING ERRCODE='42501'; END IF;

  FOR v IN SELECT x FROM jsonb_array_elements(p_visits) x ORDER BY x->>'date' LOOP
    i := i + 1;
    BEGIN v_d := (v->>'date')::date; v_st := (v->>'start')::time; v_en := (v->>'end')::time;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Visit % has a bad date or time', i; END;
    IF v_d IS NULL OR v_st IS NULL OR v_en IS NULL THEN RAISE EXCEPTION 'Visit % needs a date, start and end', i; END IF;
    IF v_en <= v_st THEN RAISE EXCEPTION 'Visit on % ends before it starts', to_char(v_d, 'DD Mon'); END IF;
    v_total := v_total + (extract(epoch FROM (v_en - v_st)) / 60)::int;
    IF v->>'id' IS NOT NULL THEN
      SELECT * INTO s FROM public.job_schedules WHERE id = (v->>'id')::uuid AND lead_id = p_lead AND job_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'Visit % is not on this booking', i; END IF;
      v_tech := CASE WHEN v_admin AND v ? 'tech' THEN COALESCE(nullif(v->>'tech','')::uuid, l.assigned_agent_id) ELSE s.agent_id END;
      UPDATE public.job_schedules SET scheduled_date = v_d, start_time = v_st, end_time = v_en, agent_id = v_tech,
             notes = CASE WHEN v ? 'note' THEN nullif(trim(v->>'note'), '') ELSE notes END,
             day_index = CASE WHEN v_n > 1 THEN i END, day_count = CASE WHEN v_n > 1 THEN v_n END, updated_at = now()
       WHERE id = s.id;
      v_keep := v_keep || s.id;
    ELSE
      v_tech := CASE WHEN v_admin THEN COALESCE(nullif(v->>'tech','')::uuid, l.assigned_agent_id) ELSE l.assigned_agent_id END;
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count)
        VALUES (p_lead, NULL, v_tech, v_d, v_st, v_en, nullif(trim(v->>'note'), ''), CASE WHEN v_n > 1 THEN i END, CASE WHEN v_n > 1 THEN v_n END)
        RETURNING id INTO s.id;
      v_keep := v_keep || s.id;
    END IF;
    IF v_tech IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v_tech AND pr.company_id = l.company_id) THEN
      RAISE EXCEPTION 'Visit % tech is not in this company', i; END IF;
  END LOOP;
  DELETE FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL AND NOT (id = ANY (v_keep));
  SELECT scheduled_date, start_time INTO v_first FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL ORDER BY scheduled_date, start_time LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.leads SET scheduled_date = NULL, scheduled_time = NULL WHERE id = p_lead;
  ELSE
    UPDATE public.leads SET scheduled_date = v_first.scheduled_date, scheduled_time = v_first.start_time WHERE id = p_lead;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date, 'start', to_char(start_time,'HH24:MI'), 'end', to_char(end_time,'HH24:MI'), 'tech', agent_id, 'note', notes) ORDER BY scheduled_date), '[]')
    INTO v_new FROM public.job_schedules WHERE lead_id = p_lead AND job_id IS NULL;
  IF v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('leads', p_lead, 'update', jsonb_build_object('source','set_booking_visits','visits', v_old),
              jsonb_build_object('source','set_booking_visits','visits', v_new, 'total_minutes', v_total, 'by_role', CASE WHEN v_admin THEN 'admin' ELSE 'rep' END), v_uid, l.company_id);
  END IF;
  RETURN jsonb_build_object('visits', v_new, 'total_minutes', v_total, 'changed', v_new IS DISTINCT FROM v_old);
END $function$;

REVOKE ALL ON FUNCTION public.booking_edit_perms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_edit_perms(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_booking_visits(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_booking_visits(uuid, jsonb) TO authenticated;
