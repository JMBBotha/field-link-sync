-- Johan 31 Oct: edit a booking (lead without a job) from the sales booking view.
-- Admin + linked admin: full edit. Rep who owns the lead/customer: date, time, notes only. Logged to audit_log.
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

CREATE OR REPLACE FUNCTION public.update_booking_details(
  p_lead uuid, p_date date DEFAULT NULL, p_time time DEFAULT NULL, p_notes text DEFAULT NULL,
  p_service_type text DEFAULT NULL, p_address text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; p jsonb; v_admin boolean; v_ch jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE='42501'; END IF;
  p := public.booking_edit_perms(p_lead);
  v_admin := (p->>'admin')::boolean;
  IF NOT (v_admin OR (p->>'rep')::boolean) THEN RAISE EXCEPTION 'You can''t edit this booking' USING ERRCODE='42501'; END IF;
  IF NOT v_admin AND ((p_service_type IS NOT NULL AND p_service_type IS DISTINCT FROM l.service_type)
       OR (p_address IS NOT NULL AND p_address IS DISTINCT FROM l.customer_address)) THEN
    RAISE EXCEPTION 'Only an admin can change the service or address' USING ERRCODE='42501'; END IF;

  IF p_date IS NOT NULL AND p_date IS DISTINCT FROM l.scheduled_date THEN
    v_ch := v_ch || jsonb_build_object('scheduled_date', jsonb_build_object('from', l.scheduled_date, 'to', p_date)); END IF;
  IF p_time IS NOT NULL AND p_time IS DISTINCT FROM l.scheduled_time THEN
    v_ch := v_ch || jsonb_build_object('scheduled_time', jsonb_build_object('from', l.scheduled_time, 'to', p_time)); END IF;
  IF p_notes IS NOT NULL AND nullif(trim(p_notes),'') IS DISTINCT FROM l.notes THEN
    v_ch := v_ch || jsonb_build_object('notes', jsonb_build_object('from', l.notes, 'to', nullif(trim(p_notes),''))); END IF;
  IF p_service_type IS NOT NULL AND p_service_type IS DISTINCT FROM l.service_type THEN
    v_ch := v_ch || jsonb_build_object('service_type', jsonb_build_object('from', l.service_type, 'to', p_service_type)); END IF;
  IF p_address IS NOT NULL AND nullif(trim(p_address),'') IS DISTINCT FROM l.customer_address THEN
    v_ch := v_ch || jsonb_build_object('customer_address', jsonb_build_object('from', l.customer_address, 'to', nullif(trim(p_address),''))); END IF;
  IF v_ch = '{}'::jsonb THEN RETURN jsonb_build_object('ok', true, 'changes', v_ch); END IF;

  UPDATE public.leads SET
    scheduled_date = COALESCE(p_date, scheduled_date),
    scheduled_time = COALESCE(p_time, scheduled_time),
    notes = CASE WHEN p_notes IS NULL THEN notes ELSE nullif(trim(p_notes),'') END,
    service_type = COALESCE(p_service_type, service_type),
    customer_address = CASE WHEN p_address IS NULL THEN customer_address ELSE COALESCE(nullif(trim(p_address),''), customer_address) END
  WHERE id = p_lead;
  INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('leads', p_lead, 'update', jsonb_build_object('source','booking_edit'), v_ch || jsonb_build_object('source','booking_edit','by_admin', v_admin), v_uid, l.company_id);
  RETURN jsonb_build_object('ok', true, 'changes', v_ch);
END $function$;

REVOKE ALL ON FUNCTION public.booking_edit_perms(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_booking_details(uuid, date, time, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_edit_perms(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_booking_details(uuid, date, time, text, text, text) TO authenticated;
