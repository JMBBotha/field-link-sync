-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Restores booking_edit_perms and set_booking_visits to the bodies this migration replaced, and drops the two new functions.

DROP FUNCTION IF EXISTS public.cancel_booking_visit(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.set_quote_group_salesperson(uuid, uuid);

CREATE OR REPLACE FUNCTION public.booking_edit_perms(p_lead uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; v_admin boolean; v_rep boolean;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF v_uid IS NULL OR NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RETURN jsonb_build_object('admin', false, 'rep', false, 'view', false); END IF;
  v_admin := COALESCE(public.fl_job_admin_ok(v_uid, l.company_id), false);
  v_rep := COALESCE(public.rep_owns_lead(v_uid, p_lead), false)
    OR (l.customer_id IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, l.customer_id, l.company_id), false));
  RETURN jsonb_build_object('admin', v_admin, 'rep', v_rep,
    'view', v_admin OR v_rep OR NOT COALESCE(public.is_sales_rep(v_uid), false));
END $function$;

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
  IF p_visits IS NULL OR jsonb_typeof(p_visits) <> 'array' OR jsonb_array_length(p_visits) = 0 THEN RAISE EXCEPTION 'Add at least one visit'; END IF;
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
  UPDATE public.leads SET scheduled_date = v_first.scheduled_date, scheduled_time = v_first.start_time WHERE id = p_lead;
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
