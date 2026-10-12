-- Tech accept of an unassigned offer (12 Oct). RLS only lets techs update leads already assigned to them,
-- so the app's direct UPDATE silently changed 0 rows. This narrow SECURITY DEFINER path claims for the caller only.
-- Fit/clash (_tech_claim_guard) and same-client (_same_client_claim_guard) triggers still run (auth.uid() = the tech).
CREATE OR REPLACE FUNCTION public.tech_accept_lead(p_lead uuid, p_date date, p_time time, p_minutes int, p_end timestamptz DEFAULT NULL,
  p_title text DEFAULT NULL, p_description text DEFAULT NULL, p_priority text DEFAULT NULL, p_address text DEFAULT NULL, p_location_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); l public.leads; v_job uuid; v_m int := GREATEST(COALESCE(p_minutes, 60), 15);
  v_start timestamptz := (p_date + p_time) AT TIME ZONE 'Africa/Johannesburg';
BEGIN
  IF v_uid IS NULL OR NOT public.is_field_tech_only(v_uid) THEN
    RAISE EXCEPTION 'Only technicians can accept offers this way' USING ERRCODE = '42501'; END IF;
  IF p_date IS NULL OR p_time IS NULL THEN RAISE EXCEPTION 'Pick a date and time that fits your day before accepting'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF l.id IS NULL OR l.company_id IS DISTINCT FROM public.get_user_company_id(v_uid) THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF l.deleted_at IS NOT NULL OR l.merged_into_id IS NOT NULL OR l.status NOT IN ('pending','open','released') THEN
    RAISE EXCEPTION 'This offer is no longer available'; END IF;
  IF l.assigned_agent_id IS NOT NULL AND l.assigned_agent_id <> v_uid THEN
    RAISE EXCEPTION 'Someone else already took this job'; END IF;
  UPDATE public.leads SET status = 'accepted', assigned_agent_id = v_uid, scheduled_date = p_date, scheduled_time = p_time,
    estimated_duration_minutes = v_m, estimated_end_time = COALESCE(p_end, v_start + make_interval(mins => v_m)),
    accepted_at = now()
   WHERE id = p_lead;
  -- Job + assignment + log (techs can't insert these under RLS either); same fields as useAcceptLead.
  SELECT id INTO v_job FROM public.jobs WHERE lead_id = p_lead LIMIT 1;
  IF v_job IS NULL THEN
    INSERT INTO public.jobs (title, description, address, lat, lng, priority, scheduled_for, estimated_duration, status, location_id,
      company_id, customer_id, lead_id, created_by, job_type)
    VALUES (COALESCE(NULLIF(p_title, ''), l.service_type, 'Service'), NULLIF(p_description, ''), COALESCE(NULLIF(p_address, ''), l.customer_address),
      l.latitude, l.longitude, CASE WHEN lower(COALESCE(p_priority, l.priority, '')) IN ('low','normal','high','urgent') THEN lower(COALESCE(p_priority, l.priority)) ELSE 'normal' END, v_start, make_interval(mins => v_m), 'scheduled', p_location_id,
      l.company_id, l.customer_id, p_lead, v_uid, CASE WHEN l.service_type ILIKE '%install%' THEN 'installation' WHEN l.service_type ILIKE '%quote%' THEN 'quote'
        WHEN l.service_type ILIKE '%repair%' THEN 'repair' WHEN l.service_type ILIKE '%mainten%' THEN 'maintenance' WHEN l.service_type ILIKE '%survey%' THEN 'survey' ELSE 'service' END)
    RETURNING id INTO v_job;
  ELSE
    UPDATE public.jobs SET scheduled_for = v_start, estimated_duration = make_interval(mins => v_m), status = 'scheduled' WHERE id = v_job;
  END IF;
  IF EXISTS (SELECT 1 FROM public.assignments WHERE job_id = v_job AND profile_id = v_uid) THEN
    UPDATE public.assignments SET status = 'accepted', assigned_by = v_uid WHERE job_id = v_job AND profile_id = v_uid;
  ELSE
    INSERT INTO public.assignments (job_id, profile_id, assigned_by, status, assignment_type) VALUES (v_job, v_uid, v_uid, 'accepted', 'internal');
  END IF;
  INSERT INTO public.job_activity_log (job_id, user_id, action, details)
  VALUES (v_job, v_uid, 'accepted_and_scheduled', jsonb_build_object('lead_id', p_lead, 'scheduled_for', v_start, 'agent_id', v_uid, 'via', 'tech_accept_lead'));
  RETURN jsonb_build_object('ok', true, 'lead_id', p_lead, 'job_id', v_job);
END $f$;
REVOKE ALL ON FUNCTION public.tech_accept_lead(uuid,date,time,int,timestamptz,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_accept_lead(uuid,date,time,int,timestamptz,text,text,text,text,uuid) TO authenticated;
