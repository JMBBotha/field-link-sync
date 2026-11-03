-- Job type choice (Johan 3 Nov 2026). NOT applied to live; branch only.
-- 1) Tech job type changes are requests: nothing changes until an admin/owner approves (Johan answer 5).
-- 2) No on-site service -> installation conversion: approving a type change only changes the job type label
--    (installation = 'quote' until the job's quote has status 'accepted', then 'installation').
-- 3) Tech sales button, two options:
--    a) Unit not viable: closes the service job as a call-out (R680 excl. VAT, never deducted) and creates a
--       replacement-quote New sale lead (client's own rep, else the rep offer).
--    b) Client also needs a new quote / installation: New sale lead immediately; the job stays as is.
--    No lead credit or commission: leads only record raised_by_tech for reporting (Johan 14:18).
-- Repair is part of service; Move stays its own request type. Notifications carry no client names (POPIA).

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS raised_by_tech uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('call_out_only'));
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS call_out_excl_vat numeric(10,2);
COMMENT ON COLUMN public.jobs.call_out_excl_vat IS 'Call-out charged on this visit, excl. VAT. Never deducted from a repair or quote.';
COMMENT ON COLUMN public.leads.raised_by_tech IS 'Tech who flagged this sales lead from a job. Reporting only: no credit or commission logic.';

CREATE TABLE IF NOT EXISTS public.job_type_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  from_type text,
  to_type text NOT NULL CHECK (to_type IN ('service','installation')),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_type_change_one_pending ON public.job_type_change_requests(job_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS job_type_change_company_status ON public.job_type_change_requests(company_id, status);

ALTER TABLE public.job_type_change_requests ENABLE ROW LEVEL SECURITY;
-- read only; all writes go through the functions below
CREATE POLICY job_type_change_office_read ON public.job_type_change_requests FOR SELECT TO authenticated
  USING (public.fl_is_company_office(auth.uid(), company_id));
CREATE POLICY job_type_change_own_read ON public.job_type_change_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.job_type_change_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._job_tech_ok(p_uid uuid, p_job uuid, p_co uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job AND a.profile_id = p_uid)
      OR public.fl_is_company_office(p_uid, p_co);
$$;
REVOKE ALL ON FUNCTION public._job_tech_ok(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- New sale lead from a job (client, address, pin from the job/customer). Routed by the existing leads trigger
-- (client's own rep, else the rep offer).
CREATE OR REPLACE FUNCTION public._job_sales_lead(p_job uuid, p_uid uuid, p_note text, p_by_tech boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; v_lead uuid;
BEGIN
  SELECT jb.id, jb.company_id, jb.customer_id, jb.address, jb.lat, jb.lng, c.name, c.phone, c.address AS c_address, c.latitude, c.longitude
    INTO j FROM public.jobs jb LEFT JOIN public.customers c ON c.id = jb.customer_id WHERE jb.id = p_job;
  PERFORM set_config('fl.request_type', 'new_sale', true);
  INSERT INTO public.leads (customer_name, customer_phone, phone, notes, service_type, status, source, primary_intent, customer_id, company_id,
                            created_by, customer_address, latitude, longitude, raised_by_tech)
  VALUES (COALESCE(j.name, 'Unknown'), COALESCE(j.phone, ''), j.phone,
          left(concat_ws(E'\n', 'From job ' || left(p_job::text, 8) || CASE WHEN p_by_tech THEN ' (tech)' ELSE ' (job type change)' END, NULLIF(trim(p_note), '')), 1000),
          'New sale', 'pending', 'manual', 'sales'::public.lead_intent, j.customer_id, j.company_id, p_uid,
          COALESCE(j.address, j.c_address, 'Not given'), COALESCE(j.lat, j.latitude, 0), COALESCE(j.lng, j.longitude, 0),
          CASE WHEN p_by_tech THEN p_uid END)
  RETURNING id INTO v_lead;
  PERFORM set_config('fl.request_type', '', true);
  RETURN v_lead;
END $$;
REVOKE ALL ON FUNCTION public._job_sales_lead(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_job_type_change(p_job_id uuid, p_to text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); j record; v_from text; v_req uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sign in first'); END IF;
  SELECT id, company_id, job_type, status INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.id IS NULL OR NOT public._job_tech_ok(v_uid, j.id, j.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Job not found'); END IF;
  IF j.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok', false, 'message', 'This job is closed'); END IF;
  IF p_to NOT IN ('service','installation') THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick service or installation'); END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RETURN jsonb_build_object('ok', false, 'message', 'Say why'); END IF;
  v_from := CASE WHEN j.job_type IN ('service','service_call','repair','maintenance') THEN 'service' ELSE 'installation' END;
  IF v_from = p_to THEN RETURN jsonb_build_object('ok', false, 'message', 'The job already has that type'); END IF;
  IF EXISTS (SELECT 1 FROM public.job_type_change_requests WHERE job_id = j.id AND status = 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Already waiting for admin');
  END IF;
  INSERT INTO public.job_type_change_requests (company_id, job_id, requested_by, from_type, to_type, reason)
  VALUES (j.company_id, j.id, v_uid, j.job_type, p_to, left(trim(p_reason), 500)) RETURNING id INTO v_req;
  -- tell the admins/owners; no client names
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT p.id, 'job_type_change', 'Job type change request',
         'A tech asks to change a job to ' || CASE p_to WHEN 'service' THEN 'service / repair' ELSE 'installation' END || '. Open Requests to approve.',
         v_req, jsonb_build_object('job_id', j.id, 'request_id', v_req)
    FROM public.profiles p WHERE public.fl_is_company_admin(p.id, j.company_id) AND p.id <> v_uid;
  RETURN jsonb_build_object('ok', true, 'request_id', v_req);
END $$;

CREATE OR REPLACE FUNCTION public.decide_job_type_change(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); r public.job_type_change_requests%ROWTYPE; v_new text;
BEGIN
  SELECT * INTO r FROM public.job_type_change_requests WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL OR v_uid IS NULL OR NOT public.fl_is_company_admin(v_uid, r.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Not allowed'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'message', 'Already decided'); END IF;
  IF p_approve THEN
    -- label only: no lead, no status change
    IF r.to_type = 'service' THEN v_new := 'service';
    ELSIF EXISTS (SELECT 1 FROM public.jobs jb JOIN public.quotes q ON q.id = jb.quote_id WHERE jb.id = r.job_id AND q.status = 'accepted') THEN v_new := 'installation';
    ELSE v_new := 'quote';
    END IF;
    UPDATE public.jobs SET job_type = v_new, updated_at = now() WHERE id = r.job_id;
  END IF;
  UPDATE public.job_type_change_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END, decided_by = v_uid, decided_at = now(),
         decision_note = left(p_note, 500)
   WHERE id = r.id;
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  VALUES (r.requested_by, 'job_type_change_decided', CASE WHEN p_approve THEN 'Job type change approved' ELSE 'Job type change declined' END,
          CASE WHEN p_approve THEN 'The job type label was changed.' ELSE 'The job type stays the same.' END,
          r.id, jsonb_build_object('job_id', r.job_id, 'request_id', r.id));
  RETURN jsonb_build_object('ok', true, 'request_id', r.id, 'job_type', v_new);
END $$;

CREATE OR REPLACE FUNCTION public.tech_flag_sales_lead(p_job_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); j record; v_lead uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sign in first'); END IF;
  SELECT id, company_id, customer_id INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.id IS NULL OR NOT public._job_tech_ok(v_uid, j.id, j.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Job not found'); END IF;
  IF j.customer_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'This job has no client record'); END IF;
  v_lead := public._job_sales_lead(j.id, v_uid, p_note, true);
  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead);
END $$;

CREATE OR REPLACE FUNCTION public.tech_unit_not_viable(p_job_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); j record; v_lead uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sign in first'); END IF;
  SELECT id, company_id, customer_id, job_type, status INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF j.id IS NULL OR NOT public._job_tech_ok(v_uid, j.id, j.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Job not found'); END IF;
  IF j.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok', false, 'message', 'This job is closed'); END IF;
  IF COALESCE(j.job_type, '') NOT IN ('service','service_call','repair','maintenance') THEN RETURN jsonb_build_object('ok', false, 'message', 'Only for service / repair jobs'); END IF;
  IF j.customer_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'This job has no client record'); END IF;
  -- close as a call-out only; the R680 excl. VAT is charged on its own and never deducted
  UPDATE public.jobs SET status = 'completed', completed_at = now(), outcome = 'call_out_only', call_out_excl_vat = 680, updated_at = now() WHERE id = j.id;
  v_lead := public._job_sales_lead(j.id, v_uid, concat_ws(E'\n', 'Replacement quote: unit not viable', NULLIF(trim(p_note), '')), true);
  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead);
END $$;

REVOKE ALL ON FUNCTION public.tech_unit_not_viable(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tech_unit_not_viable(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.request_job_type_change(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_job_type_change(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tech_flag_sales_lead(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_type_change(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_job_type_change(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tech_flag_sales_lead(uuid, text) TO authenticated;
