-- PR #108: booking visits carry over to the job created from the booking (Johan 1 Nov 2026).
-- Covers every job-creation path (tech_accept_lead, hand_to_technician, fl_shop_finalize, CreateJobDialog,
-- dispatch-job / dispatch-service-job / book-appointment / accept-offer / assistant tools) via a trigger on jobs.
-- Idempotent: only rows with job_id IS NULL are linked, so a second run is a no-op and nothing is duplicated.

CREATE OR REPLACE FUNCTION public.link_lead_visits_to_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n int; v_prev text; v_ids jsonb;
BEGIN
  IF NEW.lead_id IS NULL OR lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.lead_id IS NOT DISTINCT FROM OLD.lead_id
     AND NOT (lower(COALESCE(OLD.status, '')) IN ('cancelled', 'canceled')) THEN RETURN NEW; END IF;
  v_prev := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  WITH u AS (
    UPDATE public.job_schedules SET job_id = NEW.id, updated_at = now()
     WHERE lead_id = NEW.lead_id AND job_id IS NULL
    RETURNING id, scheduled_date)
  SELECT count(*), jsonb_agg(jsonb_build_object('id', id, 'date', scheduled_date) ORDER BY scheduled_date) INTO v_n, v_ids FROM u;
  IF v_n > 0 THEN
    WITH o AS (SELECT id, row_number() OVER (ORDER BY scheduled_date, start_time) AS n, count(*) OVER () AS c
                 FROM public.job_schedules WHERE job_id = NEW.id)
    UPDATE public.job_schedules s SET day_index = CASE WHEN o.c > 1 THEN o.n END, day_count = CASE WHEN o.c > 1 THEN o.c END
      FROM o WHERE o.id = s.id
       AND (s.day_index IS DISTINCT FROM CASE WHEN o.c > 1 THEN o.n END OR s.day_count IS DISTINCT FROM CASE WHEN o.c > 1 THEN o.c END);
    UPDATE public.jobs SET scheduled_until = (SELECT CASE WHEN count(*) OVER () > 1 THEN (s.scheduled_date + s.end_time) AT TIME ZONE 'Africa/Johannesburg' END
            FROM public.job_schedules s WHERE s.job_id = NEW.id ORDER BY s.scheduled_date DESC LIMIT 1)
     WHERE id = NEW.id AND (SELECT count(*) FROM public.job_schedules s WHERE s.job_id = NEW.id) > 1;
    INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('jobs', NEW.id, 'update', jsonb_build_object('lead_id', NEW.lead_id),
            jsonb_build_object('event', 'link_lead_visits', 'linked', v_n, 'visits', v_ids), auth.uid(), NEW.company_id);
  END IF;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
  RETURN NEW;
END $$;

-- Job cancelled or deleted: hand its not-yet-worked visits back to the booking (instead of losing them by cascade).
CREATE OR REPLACE FUNCTION public.unlink_job_visits_to_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prev text; v_id uuid := COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (lower(COALESCE(NEW.status, '')) IN ('cancelled', 'canceled')
                               AND lower(COALESCE(OLD.status, '')) NOT IN ('cancelled', 'canceled')) THEN RETURN NEW; END IF;
  v_prev := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  UPDATE public.job_schedules s SET job_id = NULL, updated_at = now()
   WHERE s.job_id = v_id AND s.lead_id IS NOT NULL
     AND s.scheduled_date >= (now() AT TIME ZONE 'Africa/Johannesburg')::date
     AND NOT EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = v_id AND e.work_date = s.scheduled_date);
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_link_lead_visits ON public.jobs;
CREATE TRIGGER trg_link_lead_visits AFTER INSERT OR UPDATE OF lead_id, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.link_lead_visits_to_job();
DROP TRIGGER IF EXISTS trg_unlink_job_visits_cancel ON public.jobs;
CREATE TRIGGER trg_unlink_job_visits_cancel AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.unlink_job_visits_to_lead();
DROP TRIGGER IF EXISTS trg_unlink_job_visits_delete ON public.jobs;
CREATE TRIGGER trg_unlink_job_visits_delete BEFORE DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.unlink_job_visits_to_lead();
REVOKE ALL ON FUNCTION public.link_lead_visits_to_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlink_job_visits_to_lead() FROM PUBLIC, anon, authenticated;

-- First assignment no longer overwrites a carried-over visit's own technician.
CREATE OR REPLACE FUNCTION public.sync_assignment_to_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_job record; v_lead_agent uuid; v_rows int; v_local timestamp; v_dur interval;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF v_job.id IS NULL OR v_job.scheduled_for IS NULL OR v_job.lead_id IS NULL THEN RETURN NEW; END IF;
  v_local := v_job.scheduled_for AT TIME ZONE 'Africa/Johannesburg';
  v_dur := COALESCE(v_job.estimated_duration, interval '3 hours');
  UPDATE public.leads SET assigned_agent_id = NEW.profile_id, last_activity_at = now()
   WHERE id = v_job.lead_id AND assigned_agent_id IS NULL AND scheduled_date IS NULL
     AND COALESCE(v_job.job_type,'') <> 'installation';
  SELECT assigned_agent_id INTO v_lead_agent FROM public.leads WHERE id = v_job.lead_id;
  SELECT count(*) INTO v_rows FROM public.job_schedules WHERE job_id = NEW.job_id;
  IF v_rows > 0 THEN
    UPDATE public.job_schedules SET agent_id = NEW.profile_id, updated_at = now()
     WHERE job_id = NEW.job_id AND agent_id IS DISTINCT FROM NEW.profile_id
       AND (agent_id IS NULL
            OR (TG_OP = 'UPDATE' AND agent_id = OLD.profile_id)
            -- first assignment: a single row, the booking's default person, or a non-tech (e.g. the salesperson) is replaced;
            -- a visit carried over from the booking with its own technician keeps it
            OR (TG_OP = 'INSERT' AND (v_rows = 1 OR agent_id = v_lead_agent OR NOT public._p3_is_tech(agent_id, v_job.company_id))));
  ELSE
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (v_job.lead_id, NEW.job_id, NEW.profile_id, v_local::date, v_local::time, public.booking_end_time(v_local::time, v_dur), v_job.description);
  END IF;
  RETURN NEW;
END $function$
;

-- Handover: several carried-over visits are kept rather than collapsed onto the handover date.
CREATE OR REPLACE FUNCTION public.hand_to_technician(p_quote_id uuid, p_date date, p_start time without time zone, p_minutes integer, p_mode text, p_tech_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT NULL::integer, p_force boolean DEFAULT false, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; q record; v_inv uuid; j record; v_job uuid; v_addr text; v_lat double precision; v_lng double precision;
  v_for timestamptz; v_end time; v_n int; v_tname text; v_multi boolean := COALESCE(p_days, 1) > 1; v_plan jsonb;
BEGIN
  IF p_mode NOT IN ('pick', 'offer') THEN RAISE EXCEPTION 'Choose Pick technician or Offer to technicians'; END IF;
  IF p_date IS NULL OR p_start IS NULL THEN RAISE EXCEPTION 'Date and start time are required'; END IF;
  IF NOT v_multi AND (p_minutes IS NULL OR p_minutes < 30) THEN RAISE EXCEPTION 'Duration must be at least 30 minutes'; END IF;
  IF NOT v_multi AND extract(epoch FROM p_start)::int / 60 + p_minutes > 23 * 60 + 59 THEN
    RAISE EXCEPTION 'The job can''t run past midnight — pick a shorter length'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  v_role := public._p3_handoff_role(v_uid, p_quote_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'You can''t hand over this quote' USING ERRCODE = '42501'; END IF;
  IF v_role = 'rep' AND p_mode = 'pick' THEN
    RAISE EXCEPTION 'Salespeople can''t assign technicians — use Offer to technicians' USING ERRCODE = '42501'; END IF;
  IF lower(COALESCE(q.status, '')) <> 'accepted' THEN RAISE EXCEPTION 'Quote is not accepted'; END IF;
  SELECT id INTO v_inv FROM public.invoices WHERE quote_id = q.id ORDER BY created_at LIMIT 1;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Deposit invoice required first'; END IF;
  IF p_mode = 'offer' AND q.lead_id IS NULL THEN RAISE EXCEPTION 'This quote has no lead, so it can''t be offered — pick a technician'; END IF;
  IF p_mode = 'pick' AND NOT public._p3_is_tech(p_tech_id, q.company_id) THEN RAISE EXCEPTION 'Pick an active technician in your company'; END IF;
  IF v_multi AND q.lead_id IS NULL THEN RAISE EXCEPTION 'Multi-day jobs need a client lead on the quote'; END IF;

  SELECT * INTO j FROM public.jobs WHERE quote_id = q.id AND job_type = 'installation' ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF j.id IS NOT NULL THEN
    SELECT pr.full_name INTO v_tname FROM public.assignments a JOIN public.profiles pr ON pr.id = a.profile_id
     WHERE a.job_id = j.id AND a.status <> 'rejected' LIMIT 1;
    IF v_tname IS NOT NULL OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = j.id AND a.status <> 'rejected') THEN
      RETURN jsonb_build_object('ok', false, 'job_id', j.id, 'message', 'Already handed over to ' || COALESCE(v_tname, 'a technician'));
    END IF;
    IF EXISTS (SELECT 1 FROM public.offers WHERE job_id = j.id AND status = 'pending' AND respond_by > now()) THEN
      IF p_mode = 'offer' OR v_role = 'rep' THEN
        RETURN jsonb_build_object('ok', false, 'job_id', j.id, 'message', 'Already offered to technicians — waiting for someone to accept');
      END IF;
      UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = j.id AND status = 'pending';
    END IF;
  END IF;

  IF v_multi THEN
    -- whole working days from p_date; for Pick, every day must be free (admin can Book anyway with a reason)
    v_plan := public._job_days_plan(q.company_id, j.id, CASE WHEN p_mode = 'pick' THEN p_tech_id END, p_date, p_days, NULL, p_mode = 'pick');
    IF (v_plan->>'clash_days')::int > 0 THEN
      IF NOT p_force THEN
        RETURN v_plan || jsonb_build_object('ok', false, 'clash', true, 'message',
          'Clashes on ' || (v_plan->>'clash_days') || ' of the ' || (v_plan->>'day_count') || ' days');
      END IF;
      IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'Only an admin can book over a clash' USING ERRCODE = '42501'; END IF;
      IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why you are booking over the clash'; END IF;
      INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
      VALUES ('quote', q.id, 'clash_override', 'multi-day clash on ' || (v_plan->>'clash_days') || ' day(s)', left(btrim(p_reason), 500), v_uid, q.company_id);
    END IF;
    p_minutes := (v_plan->>'total_minutes')::int;
    p_start := (v_plan->'days'->0->>'start')::time;
    p_date := (v_plan->'days'->0->>'date')::date;
  END IF;

  IF q.lead_id IS NOT NULL THEN
    SELECT customer_address, latitude, longitude INTO v_addr, v_lat, v_lng FROM public.leads WHERE id = q.lead_id;
  END IF;
  IF (v_addr IS NULL OR v_lat IS NULL) AND q.customer_id IS NOT NULL THEN
    SELECT COALESCE(v_addr, c.address), COALESCE(v_lat, c.latitude), COALESCE(v_lng, c.longitude) INTO v_addr, v_lat, v_lng
      FROM public.customers c WHERE c.id = q.customer_id;
  END IF;
  v_for := (p_date + p_start) AT TIME ZONE 'Africa/Johannesburg';
  v_end := (LEAST(extract(epoch FROM p_start)::int / 60 + p_minutes, 23 * 60 + 59) * interval '1 minute')::time;
  IF v_multi THEN PERFORM set_config('app.job_days_writing', '1', true); END IF;

  IF j.id IS NULL THEN
    INSERT INTO public.jobs (company_id, customer_id, lead_id, quote_id, invoice_id, job_type, status, title, description,
                             address, lat, lng, scheduled_for, estimated_duration, created_by)
    VALUES (q.company_id, q.customer_id, q.lead_id, q.id, v_inv, 'installation', 'scheduled',
            'Installation — ' || COALESCE(q.customer_name, 'Customer'),
            btrim('Installation from accepted quote ' || COALESCE(q.quote_number, '')),
            v_addr, v_lat, v_lng, v_for, make_interval(mins => p_minutes), v_uid)
    RETURNING id INTO v_job;
  ELSE
    v_job := j.id;
    UPDATE public.jobs SET scheduled_for = v_for, estimated_duration = make_interval(mins => p_minutes),
           lat = COALESCE(lat, v_lat), lng = COALESCE(lng, v_lng), address = COALESCE(address, v_addr), updated_at = now()
     WHERE id = v_job;
  END IF;

  IF v_multi THEN
    IF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = v_job) THEN
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
      VALUES (q.lead_id, v_job, NULL, p_date, p_start, (v_plan->'days'->0->>'end')::time, btrim('Installation — quote ' || COALESCE(q.quote_number, '')));
    END IF;
    PERFORM public._job_days_apply(v_job, CASE WHEN p_mode = 'pick' THEN p_tech_id END, v_plan);
    PERFORM set_config('app.job_days_writing', '', true);
  ELSIF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = v_job) AND q.lead_id IS NOT NULL THEN
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (q.lead_id, v_job, NULL, p_date, p_start, v_end, btrim('Installation — quote ' || COALESCE(q.quote_number, '')));
  ELSE
    -- Booking visits carried over (several rows): keep them; only a single row follows the handover date (Johan 1 Nov).
    UPDATE public.job_schedules SET scheduled_date = p_date, start_time = p_start, end_time = v_end, updated_at = now()
     WHERE job_id = v_job AND (SELECT count(*) FROM public.job_schedules x WHERE x.job_id = v_job) = 1;
  END IF;

  IF p_mode = 'pick' THEN
    INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
    VALUES (v_job, p_tech_id, 'accepted', 'internal', v_uid);
    SELECT full_name INTO v_tname FROM public.profiles WHERE id = p_tech_id;
    RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'pick', 'days', COALESCE(v_plan->'day_count', '1'::jsonb),
      'message', 'Handed to ' || COALESCE(v_tname, 'technician')
        || CASE WHEN v_multi THEN ' for ' || (v_plan->>'day_count') || ' days (' || to_char((v_plan->>'first')::date, 'DD Mon') || '–' || to_char((v_plan->>'last')::date, 'DD Mon') || ')' ELSE '' END);
  END IF;

  v_n := public._p3_offer_round(v_job, 1);
  IF v_n = 0 THEN
    PERFORM public._p3_notify_unclaimed(v_job);
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'offer', 'offered', v_n, 'days', COALESCE(v_plan->'day_count', '1'::jsonb),
    'message', CASE WHEN v_n = 0 THEN 'No technician is free then — the office has been asked to pick one'
                    ELSE 'Offered to ' || v_n || ' technician' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' — first to accept gets it' END);
END $function$
;

