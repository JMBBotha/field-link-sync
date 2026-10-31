-- Job screen: admin Mark completed / Reopen (Johan 31 Oct 11:22). Idempotent.
-- Rollback: /workspace/job-screen-2026-10-31/rollback/rollback_job_admin_actions.sql
-- Admin = company admin OR a sales login linked to a company admin (rep_linked_admin), checked server side.

CREATE OR REPLACE FUNCTION public.fl_job_admin_ok(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _company IS NOT NULL AND (
    public.fl_is_company_admin(_uid, _company)
    OR EXISTS (SELECT 1 FROM public.rep_linked_admin k
                WHERE k.rep_user_id = _uid AND k.company_id = _company
                  AND public.get_user_company_id(_uid) = _company
                  AND public.fl_is_company_admin(k.admin_user_id, _company)));
$$;

CREATE OR REPLACE FUNCTION public.my_job_permissions(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.jobs%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF NOT FOUND OR v_uid IS NULL OR public.get_user_company_id(v_uid) IS DISTINCT FROM j.company_id THEN
    RETURN jsonb_build_object('admin', false, 'linked_admin', false, 'rep', false, 'tech', false);
  END IF;
  RETURN jsonb_build_object(
    'admin', public.fl_job_admin_ok(v_uid, j.company_id),
    'linked_admin', public.fl_job_admin_ok(v_uid, j.company_id) AND NOT public.fl_is_company_admin(v_uid, j.company_id),
    'rep', COALESCE(public.fl_rep_owns_customer(v_uid, j.customer_id, j.company_id), false),
    'tech', EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job AND a.profile_id = v_uid));
END $$;

-- Let the admin RPCs below change status for a linked sales login; everything else stays blocked for reps.
CREATE OR REPLACE FUNCTION public.dl_block_rep_job_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())
     AND current_setting('app.job_admin_action', true) IS DISTINCT FROM '1'
     AND NOT (NEW.status = 'scheduled' AND coalesce(OLD.status,'') IN ('', 'draft', 'new', 'pending', 'unassigned')) THEN
    RAISE EXCEPTION 'Salespeople can''t change job status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_mark_job_completed(p_job uuid, p_at timestamptz, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.fl_job_admin_ok(auth.uid(), j.company_id) THEN
    RAISE EXCEPTION 'Only an admin can mark a job completed' USING ERRCODE = '42501'; END IF;
  IF j.status = 'completed' THEN RAISE EXCEPTION 'This job is already completed' USING ERRCODE = '22023'; END IF;
  IF j.status = 'cancelled' THEN RAISE EXCEPTION 'This job was cancelled' USING ERRCODE = '22023'; END IF;
  IF p_at IS NULL THEN RAISE EXCEPTION 'Date and time are required' USING ERRCODE = '22023'; END IF;
  IF p_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'That time is in the future' USING ERRCODE = '22023'; END IF;
  -- Past-date admin backfill rule: no client messages, no rep alerts, no auto balance invoice.
  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_admin_action', '1', true);
  UPDATE public.jobs SET status = 'completed', completed_at = p_at, started_at = COALESCE(started_at, p_at), updated_at = now()
   WHERE id = p_job;
  INSERT INTO public.job_activity_log(job_id, user_id, action, details)
    VALUES (p_job, auth.uid(), 'admin_marked_completed', jsonb_build_object('completed_at', p_at, 'note', NULLIF(btrim(p_note), ''),
      'previous_status', j.status, 'via_linked_admin', NOT public.fl_is_company_admin(auth.uid(), j.company_id), 'quiet', true));
  INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('jobs', p_job, 'update',
      jsonb_build_object('status', j.status, 'completed_at', j.completed_at, 'started_at', j.started_at),
      jsonb_build_object('event', 'admin_mark_completed', 'status', 'completed', 'completed_at', p_at, 'note', p_note), auth.uid(), j.company_id);
  PERFORM set_config('app.backfill', '', true);
  PERFORM set_config('app.job_admin_action', '', true);
  RETURN jsonb_build_object('ok', true, 'completed_at', p_at);
END $$;

CREATE OR REPLACE FUNCTION public.admin_reopen_job(p_job uuid, p_status text DEFAULT 'in_progress', p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.fl_job_admin_ok(auth.uid(), j.company_id) THEN
    RAISE EXCEPTION 'Only an admin can reopen a job' USING ERRCODE = '42501'; END IF;
  IF j.status <> 'completed' THEN RAISE EXCEPTION 'Only a completed job can be reopened' USING ERRCODE = '22023'; END IF;
  IF p_status NOT IN ('scheduled', 'in_progress') THEN RAISE EXCEPTION 'Reopen as scheduled or in progress' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_admin_action', '1', true);
  UPDATE public.jobs SET status = p_status, updated_at = now() WHERE id = p_job;
  IF j.lead_id IS NOT NULL AND p_status = 'scheduled' THEN
    UPDATE public.leads SET status = 'converted' WHERE id = j.lead_id AND status = 'completed';
  END IF;
  INSERT INTO public.job_activity_log(job_id, user_id, action, details)
    VALUES (p_job, auth.uid(), 'admin_reopened', jsonb_build_object('new_status', p_status, 'was_completed_at', j.completed_at,
      'note', NULLIF(btrim(p_note), ''), 'via_linked_admin', NOT public.fl_is_company_admin(auth.uid(), j.company_id)));
  INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('jobs', p_job, 'update', jsonb_build_object('status', j.status, 'completed_at', j.completed_at, 'started_at', j.started_at),
      jsonb_build_object('event', 'admin_reopen', 'status', p_status, 'note', p_note), auth.uid(), j.company_id);
  PERFORM set_config('app.backfill', '', true);
  PERFORM set_config('app.job_admin_action', '', true);
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;

REVOKE ALL ON FUNCTION public.admin_mark_job_completed(uuid, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reopen_job(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_job_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_job_completed(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reopen_job(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_job_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fl_job_admin_ok(uuid, uuid) TO authenticated;
