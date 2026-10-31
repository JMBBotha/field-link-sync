-- PR2 (Johan 31 Oct): sales reps upload photos for their customers' jobs (or via linked admin);
-- update_job_details with role checks, logged to job_activity_log + audit_log.

CREATE OR REPLACE FUNCTION public.photo_lead_ok(_lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND _lead IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.company_id = public.caller_company_id())
    AND CASE
      WHEN public.is_field_tech_only(auth.uid()) THEN public.tech_owns_lead(auth.uid(), _lead)
      WHEN public.is_sales_rep(auth.uid()) THEN public.rep_owns_lead(auth.uid(), _lead)
        OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = auth.uid())
        OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND public.fl_job_admin_ok(auth.uid(), l.company_id))
        OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = _lead AND j.customer_id IS NOT NULL
                   AND public.fl_rep_owns_customer(auth.uid(), j.customer_id, j.company_id))
      ELSE public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'dispatcher'::app_role)
    END;
$function$;

-- p_units: [{id, unit_label, position, brand, model, serial_number}] edits existing job_unit_details rows only.
CREATE OR REPLACE FUNCTION public.update_job_details(
  p_job uuid, p_scheduled_for timestamptz DEFAULT NULL, p_tech uuid DEFAULT NULL,
  p_note text DEFAULT NULL, p_units jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); j public.jobs%ROWTYPE; v_admin boolean; v_rep boolean;
  v_changes jsonb := '{}'::jsonb; v_old_tech uuid; u jsonb; old_u public.job_unit_details%ROWTYPE;
  v_unit_changes jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE='42501'; END IF;
  v_admin := public.fl_job_admin_ok(v_uid, j.company_id);
  v_rep := j.customer_id IS NOT NULL AND COALESCE(public.fl_rep_owns_customer(v_uid, j.customer_id, j.company_id), false);
  IF NOT (v_admin OR v_rep) THEN RAISE EXCEPTION 'You can''t edit this job' USING ERRCODE='42501'; END IF;

  SELECT profile_id INTO v_old_tech FROM public.assignments WHERE job_id = p_job ORDER BY created_at ASC LIMIT 1;
  IF p_tech IS NOT NULL AND p_tech IS DISTINCT FROM v_old_tech AND NOT v_admin THEN
    RAISE EXCEPTION 'Only an admin can change the tech' USING ERRCODE='42501'; END IF;
  IF p_units IS NOT NULL AND jsonb_array_length(p_units) > 0 AND NOT v_admin THEN
    RAISE EXCEPTION 'Only an admin can edit units' USING ERRCODE='42501'; END IF;

  IF p_scheduled_for IS NOT NULL AND p_scheduled_for IS DISTINCT FROM j.scheduled_for THEN
    UPDATE public.jobs SET scheduled_for = p_scheduled_for,
      scheduled_until = CASE WHEN j.scheduled_until IS NOT NULL AND j.scheduled_for IS NOT NULL
                             THEN j.scheduled_until + (p_scheduled_for - j.scheduled_for) END,
      updated_at = now()
    WHERE id = p_job;
    v_changes := v_changes || jsonb_build_object('scheduled_for', jsonb_build_object('from', j.scheduled_for, 'to', p_scheduled_for));
  END IF;

  IF p_tech IS NOT NULL AND p_tech IS DISTINCT FROM v_old_tech THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_tech AND p.company_id = j.company_id AND p.archived_at IS NULL) THEN
      RAISE EXCEPTION 'That tech is not in this company'; END IF;
    IF v_old_tech IS NULL THEN
      INSERT INTO public.assignments(job_id, profile_id, assigned_by, assignment_type, status)
        VALUES (p_job, p_tech, v_uid, 'internal', 'accepted');
    ELSE
      UPDATE public.assignments SET profile_id = p_tech, assigned_by = v_uid
        WHERE job_id = p_job AND profile_id = v_old_tech;
    END IF;
    v_changes := v_changes || jsonb_build_object('tech', jsonb_build_object('from', v_old_tech, 'to', p_tech));
  END IF;

  IF p_units IS NOT NULL THEN
    FOR u IN SELECT * FROM jsonb_array_elements(p_units) LOOP
      SELECT * INTO old_u FROM public.job_unit_details WHERE id = (u->>'id')::uuid AND job_id = p_job;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unit not on this job'; END IF;
      UPDATE public.job_unit_details SET
        unit_label = nullif(trim(coalesce(u->>'unit_label', old_u.unit_label)), ''),
        position = coalesce(nullif(u->>'position',''), old_u.position),
        brand = nullif(trim(coalesce(u->>'brand', old_u.brand)), ''),
        model = nullif(trim(coalesce(u->>'model', old_u.model)), ''),
        serial_number = nullif(trim(coalesce(u->>'serial_number', old_u.serial_number)), '')
      WHERE id = old_u.id;
      IF old_u.equipment_id IS NOT NULL THEN
        UPDATE public.equipment SET
          brand = nullif(trim(coalesce(u->>'brand', old_u.brand)), ''),
          model = nullif(trim(coalesce(u->>'model', old_u.model)), ''),
          serial_number = nullif(trim(coalesce(u->>'serial_number', old_u.serial_number)), '')
        WHERE id = old_u.equipment_id AND company_id = j.company_id;
      END IF;
      v_unit_changes := v_unit_changes || jsonb_build_object('id', old_u.id,
        'from', jsonb_build_object('label', old_u.unit_label, 'position', old_u.position, 'brand', old_u.brand, 'model', old_u.model, 'serial', old_u.serial_number),
        'to', u);
    END LOOP;
    IF jsonb_array_length(v_unit_changes) > 0 THEN v_changes := v_changes || jsonb_build_object('units', v_unit_changes); END IF;
  END IF;

  IF v_changes <> '{}'::jsonb THEN
    INSERT INTO public.job_activity_log(job_id, user_id, action, details)
      VALUES (p_job, v_uid, 'details_updated', v_changes || jsonb_build_object('by_role', CASE WHEN v_admin THEN 'admin' ELSE 'rep' END));
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('jobs', p_job, 'update', to_jsonb(j), v_changes || jsonb_build_object('event', 'update_job_details'), v_uid, j.company_id);
  END IF;
  IF nullif(trim(coalesce(p_note,'')), '') IS NOT NULL THEN
    INSERT INTO public.job_activity_log(job_id, user_id, action, details)
      VALUES (p_job, v_uid, 'note_added', jsonb_build_object('note', left(trim(p_note), 2000)));
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('jobs', p_job, 'update', NULL, jsonb_build_object('event', 'job_note_added', 'note', left(trim(p_note), 2000)), v_uid, j.company_id);
    v_changes := v_changes || jsonb_build_object('note', true);
  END IF;
  RETURN v_changes;
END $function$;
REVOKE ALL ON FUNCTION public.update_job_details(uuid, timestamptz, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_job_details(uuid, timestamptz, uuid, text, jsonb) TO authenticated;
