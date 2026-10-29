-- Requests intake funnel (Johan approved 29 Oct 15:03). Targets 1,2,3,5,6,7,9 (server side).
-- One funnel: every lead / bare job / manual add becomes a row in public.requests, sorted by type,
-- each step logged in request_events. leads table schema is untouched; leads rows are only copied.
-- Writes go through SECURITY DEFINER RPCs only (no direct insert/update/delete policies).

DO $$ BEGIN CREATE TYPE public.request_type AS ENUM ('new_sale','service','move','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  source text NOT NULL DEFAULT 'manual',          -- website_form | vapi_call | whatsapp | manual | job | ingest | ...
  type public.request_type,                       -- null = Needs sorting
  suggested_type public.request_type,
  type_confidence numeric,
  sorted_by text CHECK (sorted_by IN ('auto','user')),
  sort_reason text,                               -- form | keywords | ai | user | backfill
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','closed','archived')),
  customer_id uuid,
  lead_id uuid UNIQUE,
  job_id uuid,
  customer_name text,
  phone text,
  area text,
  summary text,
  routed_to text,                                 -- lead_offer | owner_rep | tech_job | admin_task
  assigned_to uuid,
  assigned_at timestamptz,
  scheduled_for date,
  first_contact_at timestamptz,
  contact_channel text,
  task_due_at timestamptz,
  done_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_company_created_idx ON public.requests (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_job_idx ON public.requests (job_id);
CREATE INDEX IF NOT EXISTS requests_assigned_idx ON public.requests (assigned_to);

CREATE TABLE IF NOT EXISTS public.request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  company_id uuid,
  actor_id uuid,
  event text NOT NULL,      -- created | auto_sorted | type_set | contacted | assigned | scheduled | routed | done | owner_rep_changed
  old_value text,
  new_value text,
  note text,                -- admin-only reasons
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_events_req_idx ON public.request_events (request_id, created_at);
CREATE INDEX IF NOT EXISTS request_events_company_idx ON public.request_events (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.request_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,          -- null = default list for every company
  type public.request_type NOT NULL,
  keyword text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS request_keywords_uq ON public.request_keywords (coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid), type, lower(keyword));

INSERT INTO public.request_keywords (company_id, type, keyword) VALUES
 (NULL,'move','move'),(NULL,'move','moving'),(NULL,'move','relocate'),(NULL,'move','relocation'),(NULL,'move','shift unit'),(NULL,'move','shift the unit'),(NULL,'move','remove and refit'),
 (NULL,'service','leak'),(NULL,'service','leaking'),(NULL,'service','not cooling'),(NULL,'service','not heating'),(NULL,'service','error'),(NULL,'service','fault'),(NULL,'service','service'),(NULL,'service','repair'),(NULL,'service','noise'),(NULL,'service','noisy'),(NULL,'service','broken'),(NULL,'service','dripping'),(NULL,'service','clean'),(NULL,'service','regas'),
 (NULL,'new_sale','quote'),(NULL,'new_sale','new unit'),(NULL,'new_sale','install'),(NULL,'new_sale','installation'),(NULL,'new_sale','buy'),(NULL,'new_sale','price'),(NULL,'new_sale','new aircon'),
 (NULL,'admin','invoice'),(NULL,'admin','statement'),(NULL,'admin','payment'),(NULL,'admin','account'),(NULL,'admin','refund'),(NULL,'admin','proof of payment'),(NULL,'admin','receipt')
ON CONFLICT DO NOTHING;

-- Owning rep on the client record (Move = internal sale to this rep).
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS owner_rep_id uuid;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS owner_rep_set_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS owner_rep_source text;

ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_keywords ENABLE ROW LEVEL SECURITY;

-- Read: office of the company sees all; sales see only rows routed to them or that they created. Techs: none (they see jobs).
DROP POLICY IF EXISTS requests_read ON public.requests;
CREATE POLICY requests_read ON public.requests FOR SELECT TO authenticated
  USING (public.fl_is_company_office(auth.uid(), company_id) OR assigned_to = auth.uid() OR created_by = auth.uid());
DROP POLICY IF EXISTS request_events_read ON public.request_events;
CREATE POLICY request_events_read ON public.request_events FOR SELECT TO authenticated
  USING (public.fl_is_company_office(auth.uid(), company_id));
DROP POLICY IF EXISTS request_keywords_read ON public.request_keywords;
CREATE POLICY request_keywords_read ON public.request_keywords FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.fl_is_company_office(auth.uid(), company_id));

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public.fl_working_minutes(p_from timestamptz, p_to timestamptz)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(sum(GREATEST(0, EXTRACT(epoch FROM (
           LEAST(p_to, ((d::date + time '17:00') AT TIME ZONE 'Africa/Johannesburg'))
         - GREATEST(p_from, ((d::date + time '08:00') AT TIME ZONE 'Africa/Johannesburg'))
         )) / 60))::int, 0)
  FROM generate_series((p_from AT TIME ZONE 'Africa/Johannesburg')::date, (p_to AT TIME ZONE 'Africa/Johannesburg')::date, interval '1 day') d
  WHERE p_to > p_from AND EXTRACT(isodow FROM d) < 6;
$$;

CREATE OR REPLACE FUNCTION public.fl_end_of_sast_day(p_at timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT (((p_at AT TIME ZONE 'Africa/Johannesburg')::date + time '17:00') AT TIME ZONE 'Africa/Johannesburg');
$$;

-- Classification: form source first, then keywords (exactly one type hit = confident), then stored AI intent >= 0.8 agreeing.
CREATE OR REPLACE FUNCTION public.classify_request(p_company uuid, p_source text, p_text text, p_form_intent text, p_ai_intent text, p_ai_conf numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_hits jsonb; v_types text[]; v_kw text; v_ai text;
BEGIN
  -- 1. form source decides
  IF p_source IN ('website_form','website_shop') AND p_form_intent IN ('sales','service') THEN
    RETURN jsonb_build_object('type', CASE p_form_intent WHEN 'sales' THEN 'new_sale' ELSE 'service' END, 'confidence', 1, 'reason', 'form', 'auto', true);
  END IF;
  -- 2. keywords
  SELECT array_agg(DISTINCT k.type::text) INTO v_types
    FROM public.request_keywords k
   WHERE (k.company_id IS NULL OR k.company_id = p_company)
     AND p_text IS NOT NULL AND lower(p_text) ~ ('\m' || regexp_replace(lower(k.keyword), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M');
  v_kw := CASE WHEN array_length(v_types,1) = 1 THEN v_types[1] END;
  -- 'service' + 'new_sale' together with move words: move wins only if alone; otherwise ambiguous.
  v_ai := CASE p_ai_intent WHEN 'sales' THEN 'new_sale' WHEN 'service' THEN 'service' ELSE NULL END;
  IF v_kw IS NOT NULL THEN
    IF v_ai IS NOT NULL AND v_ai <> v_kw AND COALESCE(p_ai_conf,0) >= 0.8 THEN
      RETURN jsonb_build_object('type', NULL, 'suggested', v_kw, 'confidence', 0.5, 'reason', 'keywords_vs_ai', 'auto', false);
    END IF;
    RETURN jsonb_build_object('type', v_kw, 'confidence', 0.9, 'reason', 'keywords', 'auto', true);
  END IF;
  -- 3. AI intent fallback (Mandy summary already stored; nothing new is sent anywhere)
  IF v_ai IS NOT NULL AND COALESCE(p_ai_conf,0) >= 0.8 AND (v_types IS NULL OR v_ai = ANY(v_types)) THEN
    RETURN jsonb_build_object('type', v_ai, 'confidence', p_ai_conf, 'reason', 'ai', 'auto', true);
  END IF;
  RETURN jsonb_build_object('type', NULL,
    'suggested', COALESCE(v_ai, CASE WHEN v_types IS NOT NULL THEN v_types[1] END, CASE p_form_intent WHEN 'sales' THEN 'new_sale' WHEN 'service' THEN 'service' END),
    'confidence', COALESCE(p_ai_conf, 0), 'reason', CASE WHEN v_types IS NOT NULL THEN 'keywords_mixed' ELSE 'none' END, 'auto', false);
END $$;

CREATE OR REPLACE FUNCTION public._req_event(p_req uuid, p_event text, p_old text, p_new text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.request_events (request_id, company_id, actor_id, event, old_value, new_value, note)
  SELECT r.id, r.company_id, auth.uid(), p_event, p_old, p_new, p_note FROM public.requests r WHERE r.id = p_req;
$$;

CREATE OR REPLACE FUNCTION public._rep_is_active(p_rep uuid, p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p_rep IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_rep AND p.archived_at IS NULL
           AND public.fl_in_company(p_rep, p_company) AND (public.is_sales_rep(p_rep) OR public.has_role(p_rep,'admin'::app_role)));
$$;

-- Apply type-specific routing (no messages to clients; in-app notification to an owning rep only).
CREATE OR REPLACE FUNCTION public._request_route(p_req uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.requests%ROWTYPE; v_rep uuid;
BEGIN
  SELECT * INTO r FROM public.requests WHERE id = p_req;
  IF r.id IS NULL OR r.type IS NULL THEN RETURN; END IF;
  IF r.type = 'admin' THEN
    UPDATE public.requests SET routed_to = 'admin_task', task_due_at = COALESCE(task_due_at, GREATEST(public.fl_end_of_sast_day(created_at), created_at)), updated_at = now() WHERE id = r.id;
  ELSIF r.type = 'service' THEN
    UPDATE public.requests SET routed_to = 'tech_job', updated_at = now() WHERE id = r.id;
  ELSIF r.type = 'move' THEN
    SELECT owner_rep_id INTO v_rep FROM public.customers WHERE id = r.customer_id;
    IF public._rep_is_active(v_rep, r.company_id) THEN
      UPDATE public.requests SET routed_to = 'owner_rep', assigned_to = v_rep, assigned_at = COALESCE(assigned_at, now()), updated_at = now() WHERE id = r.id;
      PERFORM public._req_event(r.id, 'routed', r.routed_to, 'owner_rep', NULL);
      INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
      VALUES (v_rep, 'request_move_owner', 'Move request for your client', COALESCE(r.customer_name,'A client') || ' wants a unit moved. It is yours as an internal sale.', r.id, jsonb_build_object('request_id', r.id, 'lead_id', r.lead_id, 'customer_id', r.customer_id));
    ELSE
      UPDATE public.requests SET routed_to = 'lead_offer', updated_at = now() WHERE id = r.id;
    END IF;
  ELSE
    UPDATE public.requests SET routed_to = 'lead_offer', updated_at = now() WHERE id = r.id;
  END IF;
END $$;

-- ---------- sync from leads ----------
CREATE OR REPLACE FUNCTION public.trg_request_from_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c jsonb; v_id uuid; v_src text := NEW.source::text; v_text text; v_type public.request_type;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.merged_into_id IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.requests WHERE lead_id = NEW.id) THEN RETURN NEW; END IF;
  v_text := concat_ws(' ', NEW.service_type, NEW.notes, NEW.call_summary, NEW.call_next_action, NEW.job_info);
  IF v_src = 'manual' AND NEW.primary_intent IS NOT NULL THEN
    v_type := CASE NEW.primary_intent::text WHEN 'service' THEN 'service' ELSE 'new_sale' END;
    c := jsonb_build_object('type', v_type, 'confidence', 1, 'reason', 'user', 'auto', false);
  ELSIF v_src = 'manual' THEN
    c := jsonb_build_object('type', NULL, 'suggested', (public.classify_request(NEW.company_id, v_src, v_text, NULL, NULL, NULL))->>'suggested', 'confidence', 0, 'reason', 'manual_untyped', 'auto', false);
  ELSE
    c := public.classify_request(NEW.company_id, v_src, v_text, NEW.primary_intent::text, NEW.primary_intent::text, NEW.confidence);
  END IF;
  INSERT INTO public.requests (company_id, source, type, suggested_type, type_confidence, sorted_by, sort_reason, customer_id, lead_id,
                               customer_name, phone, area, summary, first_contact_at, contact_channel, created_by, created_at,
                               assigned_to, assigned_at, scheduled_for)
  VALUES (NEW.company_id, v_src, (c->>'type')::public.request_type, COALESCE((c->>'suggested')::public.request_type, (c->>'type')::public.request_type),
          (c->>'confidence')::numeric, CASE WHEN c->>'type' IS NULL THEN NULL WHEN (c->>'auto')::boolean THEN 'auto' ELSE 'user' END, c->>'reason',
          NEW.customer_id, NEW.id, NEW.customer_name, COALESCE(NEW.customer_phone, NEW.phone), NEW.call_area,
          left(COALESCE(NEW.call_summary, NEW.notes, NEW.service_type), 500), NEW.first_contact_at, NEW.first_contact_channel,
          COALESCE(NEW.created_by, auth.uid()), NEW.created_at,
          NEW.assigned_agent_id, CASE WHEN NEW.assigned_agent_id IS NOT NULL THEN now() END, NEW.scheduled_date)
  RETURNING id INTO v_id;
  PERFORM public._req_event(v_id, 'created', NULL, v_src, NULL);
  IF c->>'type' IS NOT NULL THEN
    PERFORM public._req_event(v_id, CASE WHEN (c->>'auto')::boolean THEN 'auto_sorted' ELSE 'type_set' END, NULL, c->>'type', c->>'reason');
    PERFORM public._request_route(v_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_request_from_lead ON public.leads;
CREATE TRIGGER trg_z_request_from_lead AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.trg_request_from_lead();

CREATE OR REPLACE FUNCTION public.trg_request_sync_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_req uuid;
BEGIN
  SELECT id INTO v_req FROM public.requests WHERE lead_id = NEW.id;
  IF v_req IS NULL THEN RETURN NEW; END IF;
  IF NEW.first_contact_at IS NOT NULL AND OLD.first_contact_at IS NULL THEN
    UPDATE public.requests SET first_contact_at = COALESCE(first_contact_at, NEW.first_contact_at), contact_channel = COALESCE(contact_channel, NEW.first_contact_channel), updated_at = now() WHERE id = v_req;
    PERFORM public._req_event(v_req, 'contacted', NULL, NEW.first_contact_channel, NULL);
  END IF;
  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    UPDATE public.requests SET assigned_to = NEW.assigned_agent_id, assigned_at = CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE now() END, updated_at = now() WHERE id = v_req;
    PERFORM public._req_event(v_req, 'assigned', OLD.assigned_agent_id::text, NEW.assigned_agent_id::text, NULL);
  END IF;
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date AND NEW.scheduled_date IS NOT NULL THEN
    UPDATE public.requests SET scheduled_for = NEW.scheduled_date, updated_at = now() WHERE id = v_req;
    PERFORM public._req_event(v_req, 'scheduled', OLD.scheduled_date::text, NEW.scheduled_date::text, NULL);
  END IF;
  IF (NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL) OR (NEW.dismissed_at IS NOT NULL AND OLD.dismissed_at IS NULL)
     OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) OR (NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS NULL) THEN
    UPDATE public.requests SET status = 'closed', updated_at = now() WHERE id = v_req AND status = 'open';
    PERFORM public._req_event(v_req, 'closed', NULL, NULL, NULL);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_request_sync_lead ON public.leads;
CREATE TRIGGER trg_z_request_sync_lead AFTER UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.trg_request_sync_lead();


-- Assignment is progress and is ALWAYS logged (the Jobs-board path used to skip lead_assignment_log).
-- Deferred to commit so assign_lead_to_tech's own log row is seen and not duplicated.
CREATE OR REPLACE FUNCTION public.trg_lead_assign_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role text;
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
     AND NOT EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = NEW.id AND g.tech_id = NEW.assigned_agent_id AND g.created_at > now() - interval '1 minute') THEN
    v_role := CASE WHEN auth.uid() IS NULL THEN 'system' WHEN public._lead_office(auth.uid(), NEW.company_id) THEN 'office' WHEN public.is_sales_rep(auth.uid()) THEN 'sales' ELSE 'self' END;
    INSERT INTO public.lead_assignment_log (lead_id, company_id, tech_id, previous_agent_id, assigned_by, by_role, scheduled_date, start_time)
    VALUES (NEW.id, NEW.company_id, NEW.assigned_agent_id, OLD.assigned_agent_id, auth.uid(), v_role, NEW.scheduled_date, NEW.scheduled_time);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_z_lead_assign_log ON public.leads;
CREATE CONSTRAINT TRIGGER trg_z_lead_assign_log AFTER UPDATE OF assigned_agent_id ON public.leads DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_assign_log();

-- Jobs: link to the lead's request, or a bare job (job dialog) becomes a Service request so it counts.
CREATE OR REPLACE FUNCTION public.trg_request_from_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_name text; v_phone text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.requests SET job_id = COALESCE(job_id, NEW.id), updated_at = now() WHERE lead_id = NEW.lead_id;
    RETURN NEW;
  END IF;
  IF NEW.quote_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.requests WHERE job_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT c.name, c.phone INTO v_name, v_phone FROM public.customers c WHERE c.id = NEW.customer_id;
  INSERT INTO public.requests (company_id, source, type, suggested_type, type_confidence, sorted_by, sort_reason, customer_id, job_id,
                               customer_name, phone, summary, created_by, created_at, routed_to, scheduled_for)
  VALUES (NEW.company_id, 'job', 'service', 'service', 1, 'user', 'job_dialog', NEW.customer_id, NEW.id, v_name, v_phone,
          left(concat_ws(' · ', NEW.title, NEW.description), 500), COALESCE(NEW.created_by, auth.uid()), NEW.created_at, 'tech_job',
          (NEW.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date)
  RETURNING id INTO v_id;
  PERFORM public._req_event(v_id, 'created', NULL, 'job', NULL);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_request_from_job ON public.jobs;
CREATE TRIGGER trg_z_request_from_job AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.trg_request_from_job();

-- Owning rep: set on the client's first accepted quote (never overwrites).
CREATE OR REPLACE FUNCTION public.trg_customer_owner_rep()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND NEW.customer_id IS NOT NULL AND NEW.sales_engineer_id IS NOT NULL THEN
    UPDATE public.customers SET owner_rep_id = NEW.sales_engineer_id, owner_rep_set_at = now(), owner_rep_source = 'first_accepted_quote'
     WHERE id = NEW.customer_id AND owner_rep_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_customer_owner_rep ON public.quotes;
CREATE TRIGGER trg_z_customer_owner_rep AFTER UPDATE OF status ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.trg_customer_owner_rep();

-- ---------- RPCs ----------
CREATE OR REPLACE FUNCTION public._req_can_act(p_req uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.requests r WHERE r.id = p_req AND auth.uid() IS NOT NULL AND (
    public.fl_is_company_office(auth.uid(), r.company_id)
    OR (public.fl_in_company(auth.uid(), r.company_id) AND (r.assigned_to = auth.uid() OR r.created_by = auth.uid()))));
$$;

-- Inbox: office sees full rows; sales see own rows in full and other open sales/move/unsorted rows masked (type + rough area only).
CREATE OR REPLACE FUNCTION public.requests_inbox(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
        'task_due_at', r.task_due_at, 'done_at', r.done_at, 'created_at', r.created_at,
        'owner_rep_name', (SELECT p.full_name FROM public.customers c JOIN public.profiles p ON p.id = c.owner_rep_id WHERE c.id = r.customer_id),
        'mine', r.assigned_to = v_uid OR r.created_by = v_uid,
        'working_min_waiting', CASE WHEN r.first_contact_at IS NULL THEN public.fl_working_minutes(r.created_at, now()) END,
        'not_contacted_red', r.status = 'open' AND r.first_contact_at IS NULL AND public.fl_working_minutes(r.created_at, now()) > 120,
        'unscheduled_nudge', r.status = 'open' AND r.type = 'service' AND r.assigned_to IS NULL AND r.job_id IS NULL AND now() - r.created_at > interval '24 hours',
        'task_overdue', r.status = 'open' AND r.type = 'admin' AND r.task_due_at IS NOT NULL AND now() > r.task_due_at)
    ELSE
      jsonb_build_object('id', r.id, 'masked', true, 'source', r.source, 'type', r.type, 'suggested_type', r.suggested_type, 'status', r.status,
        'area', r.area, 'created_at', r.created_at, 'mine', false,
        'not_contacted_red', r.status = 'open' AND r.first_contact_at IS NULL AND public.fl_working_minutes(r.created_at, now()) > 120)
    END AS row
    FROM public.requests r
    WHERE r.company_id = v_co AND r.status <> 'archived' AND r.created_at > now() - make_interval(days => GREATEST(1, LEAST(p_days, 365)))
      AND (v_office OR r.assigned_to = v_uid OR r.created_by = v_uid
           OR (r.status = 'open' AND r.assigned_to IS NULL AND (r.type IS NULL OR r.type IN ('new_sale','move'))))
  ) s;
  RETURN v_out;
END $$;

-- Today (SAST day) counts per type + needs sorting. Aggregates only, company scope; sales get company numbers + their own.
CREATE OR REPLACE FUNCTION public.requests_today_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_day0 timestamptz; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_co := public.get_user_company_id(v_uid);
  IF NOT (public.fl_is_company_office(v_uid, v_co) OR public.is_sales_rep(v_uid)) THEN RETURN NULL; END IF;
  v_day0 := (((now() AT TIME ZONE 'Africa/Johannesburg')::date)::timestamp AT TIME ZONE 'Africa/Johannesburg');
  WITH t AS (SELECT * FROM public.requests WHERE company_id = v_co AND created_at >= v_day0 AND status <> 'archived')
  SELECT jsonb_build_object(
    'in', (SELECT count(*) FROM t),
    'needs_sorting', (SELECT count(*) FROM public.requests WHERE company_id = v_co AND type IS NULL AND status = 'open'),
    'not_contacted_red', (SELECT count(*) FROM public.requests WHERE company_id = v_co AND status = 'open' AND first_contact_at IS NULL
                           AND created_at > now() - interval '30 days' AND public.fl_working_minutes(created_at, now()) > 120),
    'mine_today', (SELECT count(*) FROM t WHERE assigned_to = v_uid OR created_by = v_uid),
    'types', (SELECT jsonb_object_agg(k, jsonb_build_object(
        'in', (SELECT count(*) FROM t WHERE t.type::text = k),
        'contacted', (SELECT count(*) FROM t WHERE t.type::text = k AND t.first_contact_at IS NOT NULL),
        'assigned', (SELECT count(*) FROM t WHERE t.type::text = k AND (t.assigned_to IS NOT NULL OR t.job_id IS NOT NULL OR t.scheduled_for IS NOT NULL OR t.status = 'done'))))
      FROM unnest(ARRAY['new_sale','service','move','admin']) k)
  ) INTO v_out;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.request_set_type(p_request_id uuid, p_type public.request_type)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.requests%ROWTYPE; l public.leads%ROWTYPE;
BEGIN
  IF NOT public._req_can_act(p_request_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Request not found'); END IF;
  IF p_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick a type'); END IF;
  SELECT * INTO r FROM public.requests WHERE id = p_request_id FOR UPDATE;
  IF r.type IS NOT DISTINCT FROM p_type AND r.sorted_by = 'user' THEN RETURN jsonb_build_object('ok', true); END IF;
  UPDATE public.requests SET type = p_type, sorted_by = 'user', sort_reason = 'user', updated_at = now(),
         routed_to = NULL, task_due_at = CASE WHEN p_type = 'admin' THEN task_due_at END WHERE id = r.id;
  -- correction log (old -> new), used for weekly keyword suggestions
  PERFORM public._req_event(r.id, CASE WHEN r.type IS NULL THEN 'type_confirmed' ELSE 'type_changed' END,
                            COALESCE(r.type::text, 'suggested:' || COALESCE(r.suggested_type::text,'none')), p_type::text, r.summary);
  -- keep the lead's lane in step while nobody has it yet (sales vs service routing)
  IF r.lead_id IS NOT NULL AND p_type <> 'admin' THEN
    SELECT * INTO l FROM public.leads WHERE id = r.lead_id;
    IF l.id IS NOT NULL AND l.assigned_agent_id IS NULL AND l.closed_at IS NULL
       AND l.primary_intent IS DISTINCT FROM (CASE WHEN p_type = 'service' THEN 'service' ELSE 'sales' END)::public.lead_intent THEN
      UPDATE public.leads SET primary_intent = (CASE WHEN p_type = 'service' THEN 'service' ELSE 'sales' END)::public.lead_intent WHERE id = l.id;
    END IF;
  END IF;
  PERFORM public._request_route(r.id);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.request_mark_contacted(p_request_id uuid, p_channel text DEFAULT 'phone')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.requests%ROWTYPE; v_ch text := CASE WHEN p_channel IN ('phone','whatsapp','email','in_person') THEN p_channel ELSE 'phone' END;
BEGIN
  IF NOT public._req_can_act(p_request_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Request not found'); END IF;
  SELECT * INTO r FROM public.requests WHERE id = p_request_id FOR UPDATE;
  UPDATE public.requests SET first_contact_at = COALESCE(first_contact_at, now()), contact_channel = COALESCE(contact_channel, v_ch), updated_at = now() WHERE id = r.id;
  PERFORM public._req_event(r.id, 'contacted', NULL, v_ch, 'Mark contacted');
  IF r.lead_id IS NOT NULL THEN
    UPDATE public.leads SET first_contact_at = COALESCE(first_contact_at, now()), first_contact_channel = COALESCE(first_contact_channel, v_ch),
           last_contact_attempt_at = now(), last_contact_outcome = 'spoke'
     WHERE id = r.lead_id AND first_contact_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.request_mark_done(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._req_can_act(p_request_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Request not found'); END IF;
  UPDATE public.requests SET status = 'done', done_at = now(), updated_at = now() WHERE id = p_request_id AND status = 'open';
  PERFORM public._req_event(p_request_id, 'done', NULL, NULL, NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

-- "+ Add request" (manual / WhatsApp typed in): type is required. Sale/service/move create a normal lead (so the pipeline,
-- lead offer and Assign dialog keep working); Admin creates a task-only request.
CREATE OR REPLACE FUNCTION public.request_create(p_type public.request_type, p_name text, p_phone text, p_area text, p_text text,
                                                 p_customer_id uuid DEFAULT NULL, p_source text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_lead uuid; v_req uuid; v_src text := CASE WHEN p_source IN ('manual','whatsapp','phone','walk_in','email') THEN p_source ELSE 'manual' END;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sign in first'); END IF;
  IF p_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick what this request is'); END IF;
  IF COALESCE(trim(p_name),'') = '' AND p_customer_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Add the client name'); END IF;
  v_co := public.get_user_company_id(v_uid);
  IF NOT (public.fl_is_company_office(v_uid, v_co) OR public.is_sales_rep(v_uid)) THEN RETURN jsonb_build_object('ok', false, 'message', 'Not allowed'); END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND company_id = v_co) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Client not found');
  END IF;
  IF p_type = 'admin' THEN
    INSERT INTO public.requests (company_id, source, type, suggested_type, type_confidence, sorted_by, sort_reason, customer_id, customer_name, phone, area, summary, created_by)
    VALUES (v_co, v_src, 'admin', 'admin', 1, 'user', 'user', p_customer_id, COALESCE(NULLIF(trim(p_name),''), (SELECT name FROM public.customers WHERE id = p_customer_id)), p_phone, p_area, left(p_text, 500), v_uid)
    RETURNING id INTO v_req;
    PERFORM public._req_event(v_req, 'created', NULL, v_src, NULL);
    PERFORM public._req_event(v_req, 'type_set', NULL, 'admin', 'user');
    PERFORM public._request_route(v_req);
  ELSE
    INSERT INTO public.leads (customer_name, customer_phone, phone, notes, service_type, status, source, primary_intent, customer_id, company_id, created_by, call_area, customer_address, latitude, longitude)
    VALUES (COALESCE(NULLIF(trim(p_name),''), (SELECT name FROM public.customers WHERE id = p_customer_id), 'Unknown'),
            COALESCE(NULLIF(trim(p_phone),''), (SELECT phone FROM public.customers WHERE id = p_customer_id), ''), NULLIF(trim(p_phone),''), p_text,
            CASE p_type WHEN 'service' THEN 'Service / repair' WHEN 'move' THEN 'Move unit' ELSE 'New sale' END,
            'pending', 'manual', (CASE WHEN p_type = 'service' THEN 'service' ELSE 'sales' END)::public.lead_intent, p_customer_id, v_co, v_uid, p_area,
            COALESCE((SELECT address FROM public.customers WHERE id = p_customer_id), NULLIF(trim(p_area),''), 'Not given'),
            COALESCE((SELECT latitude FROM public.customers WHERE id = p_customer_id), 0), COALESCE((SELECT longitude FROM public.customers WHERE id = p_customer_id), 0))
    RETURNING id INTO v_lead;
    SELECT id INTO v_req FROM public.requests WHERE lead_id = v_lead;
    IF v_req IS NOT NULL THEN
      UPDATE public.requests SET source = v_src, created_by = v_uid, updated_at = now() WHERE id = v_req;
      IF p_type = 'move' THEN
        UPDATE public.requests SET type = 'move', suggested_type = 'move', sorted_by = 'user', sort_reason = 'user', routed_to = NULL WHERE id = v_req;
        PERFORM public._req_event(v_req, 'type_set', 'new_sale', 'move', 'user');
        PERFORM public._request_route(v_req);
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'request_id', v_req, 'lead_id', v_lead);
END $$;

-- Owning rep change (admin only). Reason is stored in request_events/customer audit, never shown to the old rep.
CREATE OR REPLACE FUNCTION public.set_customer_owner_rep(p_customer_id uuid, p_rep_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.customers%ROWTYPE; v_req uuid;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF c.id IS NULL OR NOT public.fl_is_company_office(auth.uid(), c.company_id) OR public.is_sales_rep(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only admin can change the client''s rep');
  END IF;
  IF p_rep_id IS NOT NULL AND NOT public._rep_is_active(p_rep_id, c.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick an active salesperson in this company'); END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick a reason'); END IF;
  UPDATE public.customers SET owner_rep_id = p_rep_id, owner_rep_set_at = now(), owner_rep_source = 'admin' WHERE id = c.id;
  -- log against the client's latest request (or a closed audit-only request row if none)
  SELECT id INTO v_req FROM public.requests WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1;
  IF v_req IS NULL THEN
    INSERT INTO public.requests (company_id, source, status, customer_id, customer_name, created_by, summary)
    VALUES (c.company_id, 'audit', 'archived', c.id, c.name, auth.uid(), 'Owner rep change') RETURNING id INTO v_req;
  END IF;
  PERFORM public._req_event(v_req, 'owner_rep_changed', c.owner_rep_id::text, p_rep_id::text, p_reason);
  -- open move requests follow the new rep
  UPDATE public.requests SET assigned_to = p_rep_id, assigned_at = now(), routed_to = 'owner_rep', updated_at = now()
   WHERE customer_id = c.id AND type = 'move' AND status = 'open' AND routed_to = 'owner_rep';
  IF c.owner_rep_id IS NOT NULL AND c.owner_rep_id IS DISTINCT FROM p_rep_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (c.owner_rep_id, 'owner_rep_reassigned', 'Client reassigned', COALESCE(c.name,'A client') || ' was reassigned.', c.id, jsonb_build_object('customer_id', c.id));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Weekly learning: top corrections (admin/office only). Nothing self-modifies.
CREATE OR REPLACE FUNCTION public.request_top_corrections(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid()); v_out jsonb;
BEGIN
  IF NOT public.fl_is_company_office(auth.uid(), v_co) OR public.is_sales_rep(auth.uid()) THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'n')::int DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object('word', w, 'type', e.new_value, 'n', count(*)) x
      FROM public.request_events e,
           LATERAL (SELECT DISTINCT w FROM regexp_split_to_table(lower(COALESCE(e.note,'')), '[^a-z]+') w WHERE length(w) >= 4
                      AND w NOT IN ('with','that','this','have','from','they','will','your','what','please','would','there','their','about','unit','client','called')) ws
     WHERE e.company_id = v_co AND e.event IN ('type_changed','type_confirmed') AND e.created_at > now() - make_interval(days => p_days)
       AND NOT EXISTS (SELECT 1 FROM public.request_keywords k WHERE (k.company_id IS NULL OR k.company_id = v_co) AND lower(k.keyword) = w)
     GROUP BY w, e.new_value HAVING count(*) >= 2 LIMIT 20) s;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.request_add_keyword(p_type public.request_type, p_keyword text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid());
BEGIN
  IF NOT public.fl_is_company_office(auth.uid(), v_co) OR public.is_sales_rep(auth.uid()) THEN RETURN jsonb_build_object('ok', false, 'message', 'Admin only'); END IF;
  IF length(trim(COALESCE(p_keyword,''))) < 3 THEN RETURN jsonb_build_object('ok', false, 'message', 'Keyword too short'); END IF;
  INSERT INTO public.request_keywords (company_id, type, keyword, created_by) VALUES (v_co, p_type, lower(trim(p_keyword)), auth.uid()) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.classify_request(uuid,text,text,text,text,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._req_event(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._request_route(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requests_inbox(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.requests_today_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_set_type(uuid, public.request_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_mark_contacted(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_mark_done(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_create(public.request_type, text, text, text, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_owner_rep(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_top_corrections(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_add_keyword(public.request_type, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.requests_inbox(integer), public.requests_today_counts(), public.request_set_type(uuid, public.request_type),
  public.request_mark_contacted(uuid, text), public.request_mark_done(uuid), public.request_create(public.request_type, text, text, text, text, uuid, text),
  public.set_customer_owner_rep(uuid, uuid, text), public.request_top_corrections(integer), public.request_add_keyword(public.request_type, text) TO authenticated;

-- ---------- backfill (copy only; leads rows are not modified) ----------
INSERT INTO public.requests (company_id, source, type, suggested_type, type_confidence, sorted_by, sort_reason, status, customer_id, lead_id, customer_name, phone, area, summary,
                             first_contact_at, contact_channel, assigned_to, assigned_at, scheduled_for, created_by, created_at, routed_to)
SELECT l.company_id, l.source::text,
       CASE l.primary_intent::text WHEN 'sales' THEN 'new_sale' WHEN 'service' THEN 'service' END::public.request_type,
       CASE WHEN l.primary_intent::text = 'service' THEN 'service' WHEN l.primary_intent IS NOT NULL OR l.status = 'converted' THEN 'new_sale' END::public.request_type,
       CASE WHEN l.primary_intent IS NOT NULL THEN 1 END, CASE WHEN l.primary_intent IS NOT NULL THEN 'user' END, 'backfill',
       CASE WHEN l.closed_at IS NOT NULL OR l.dismissed_at IS NOT NULL OR l.status IN ('converted','cancelled','resolved_before_visit','completed','lost') THEN 'closed'
            WHEN l.primary_intent IS NULL AND l.created_at < now() - interval '30 days' THEN 'archived' ELSE 'open' END,
       l.customer_id, l.id, l.customer_name, COALESCE(l.customer_phone, l.phone), l.call_area, left(COALESCE(l.call_summary, l.notes, l.service_type), 500),
       l.first_contact_at, l.first_contact_channel, l.assigned_agent_id,
       CASE WHEN l.assigned_agent_id IS NOT NULL THEN COALESCE((SELECT max(g.created_at) FROM public.lead_assignment_log g WHERE g.lead_id = l.id), l.accepted_at, l.created_at) END,
       l.scheduled_date, l.created_by, l.created_at,
       CASE l.primary_intent::text WHEN 'sales' THEN 'lead_offer' WHEN 'service' THEN 'tech_job' END
  FROM public.leads l
 WHERE l.deleted_at IS NULL AND l.merged_into_id IS NULL
ON CONFLICT (lead_id) DO NOTHING;

INSERT INTO public.requests (company_id, source, type, suggested_type, type_confidence, sorted_by, sort_reason, customer_id, job_id, customer_name, phone, summary, created_by, created_at, routed_to, scheduled_for,
                             status)
SELECT j.company_id, 'job', 'service', 'service', 1, 'user', 'backfill', j.customer_id, j.id, c.name, c.phone, left(concat_ws(' · ', j.title, j.description), 500), j.created_by, j.created_at, 'tech_job',
       (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date, CASE WHEN j.status IN ('completed','cancelled') THEN 'closed' ELSE 'open' END
  FROM public.jobs j LEFT JOIN public.customers c ON c.id = j.customer_id
 WHERE j.lead_id IS NULL AND j.quote_id IS NULL AND j.created_at > now() - interval '30 days'
   AND NOT EXISTS (SELECT 1 FROM public.requests r WHERE r.job_id = j.id);

UPDATE public.requests r SET job_id = j.id FROM public.jobs j WHERE r.lead_id = j.lead_id AND r.job_id IS NULL;

INSERT INTO public.request_events (request_id, company_id, actor_id, event, new_value, note, created_at)
SELECT r.id, r.company_id, NULL, 'created', r.source, 'backfill', r.created_at FROM public.requests r
 WHERE NOT EXISTS (SELECT 1 FROM public.request_events e WHERE e.request_id = r.id);

-- owning rep backfill from the latest accepted quote
UPDATE public.customers c SET owner_rep_id = q.sales_engineer_id, owner_rep_set_at = now(), owner_rep_source = 'backfill_accepted_quote'
  FROM (SELECT DISTINCT ON (customer_id) customer_id, sales_engineer_id FROM public.quotes
         WHERE status = 'accepted' AND customer_id IS NOT NULL AND sales_engineer_id IS NOT NULL ORDER BY customer_id, accepted_at DESC NULLS LAST) q
 WHERE c.id = q.customer_id AND c.owner_rep_id IS NULL;
