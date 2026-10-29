-- Move requests go to the client's owning rep, not the open lead-offer race (Johan, 29 Oct).
-- A lead that is a move (manual request_create type move, or web/Mandy text that auto-sorts as move) for a client whose
-- owner_rep_id is active in the same company is assigned to that rep BEFORE it is saved, so the existing auto-assign
-- triggers (which only fire for unassigned leads) never broadcast it. No owner rep / inactive rep -> unchanged (normal offer).

CREATE OR REPLACE FUNCTION public._lead_move_owner_rep(p_lead public.leads, p_is_move boolean)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rep uuid; v_move boolean := p_is_move;
BEGIN
  IF p_lead.customer_id IS NULL OR p_lead.assigned_agent_id IS NOT NULL OR p_lead.closed_at IS NOT NULL OR p_lead.dismissed_at IS NOT NULL
     OR p_lead.deleted_at IS NOT NULL OR p_lead.primary_intent::text = 'service' THEN RETURN NULL; END IF;
  -- same inputs as trg_request_from_lead, so the lead and its request always agree on "move"
  IF NOT v_move AND p_lead.source::text <> 'manual' THEN
    v_move := (public.classify_request(p_lead.company_id, p_lead.source::text,
                 concat_ws(' ', p_lead.service_type, p_lead.notes, p_lead.call_summary, p_lead.call_next_action, p_lead.job_info),
                 p_lead.primary_intent::text, p_lead.primary_intent::text, p_lead.confidence)) @> '{"type":"move","auto":true}'::jsonb;
  END IF;
  IF NOT v_move THEN RETURN NULL; END IF;
  SELECT c.owner_rep_id INTO v_rep FROM public.customers c WHERE c.id = p_lead.customer_id AND c.company_id = p_lead.company_id;
  IF public._rep_is_active(v_rep, p_lead.company_id) THEN RETURN v_rep; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._lead_move_owner_rep(public.leads, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_lead_move_owner_rep()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rep uuid; v_move boolean;
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    v_move := COALESCE(current_setting('fl.request_type', true), '') = 'move';
  ELSE
    v_move := EXISTS (SELECT 1 FROM public.requests r WHERE r.lead_id = NEW.id AND r.type = 'move');
  END IF;
  v_rep := public._lead_move_owner_rep(NEW, v_move);
  IF v_rep IS NOT NULL THEN
    NEW.assigned_agent_id := v_rep;
    NEW.assignment_method := 'owner_rep';
    NEW.accepted_at := COALESCE(NEW.accepted_at, now());
    IF TG_OP = 'UPDATE' THEN
      -- trigger-set columns don't fire trg_z_lead_assign_log (UPDATE OF assigned_agent_id), so log here
      NEW.primary_intent := COALESCE(NEW.primary_intent, 'sales'::public.lead_intent);
      INSERT INTO public.lead_assignment_log (lead_id, company_id, tech_id, previous_agent_id, assigned_by, by_role)
      VALUES (NEW.id, NEW.company_id, v_rep, NULL, COALESCE(auth.uid(), NEW.created_by, v_rep), 'owner_rep_move');
    END IF;
    -- INSERT: primary_intent is left as is so the request row classifies the text as a move (logged by trg_z_lead_move_owner_log)
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_a_lead_move_owner_rep ON public.leads;
CREATE TRIGGER trg_a_lead_move_owner_rep BEFORE INSERT OR UPDATE OF primary_intent, customer_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_move_owner_rep();

-- Insert path: the assignment above happens before the request row exists, so log it once the request is created.
-- (lead_assignment_log only gets UPDATE-time rows from trg_z_lead_assign_log.)
CREATE OR REPLACE FUNCTION public.trg_lead_move_owner_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.assignment_method = 'owner_rep' AND NEW.assigned_agent_id IS NOT NULL THEN
    INSERT INTO public.lead_assignment_log (lead_id, company_id, tech_id, previous_agent_id, assigned_by, by_role)
    VALUES (NEW.id, NEW.company_id, NEW.assigned_agent_id, NULL, COALESCE(auth.uid(), NEW.created_by, NEW.assigned_agent_id), 'owner_rep_move');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_z_lead_move_owner_log ON public.leads;
CREATE TRIGGER trg_z_lead_move_owner_log AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.trg_lead_move_owner_log();

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
    -- tell the lead BEFORE INSERT trigger this is a move so it goes to the client's rep, not the open offer
    PERFORM set_config('fl.request_type', p_type::text, true);
    INSERT INTO public.leads (customer_name, customer_phone, phone, notes, service_type, status, source, primary_intent, customer_id, company_id, created_by, call_area, customer_address, latitude, longitude)
    VALUES (COALESCE(NULLIF(trim(p_name),''), (SELECT name FROM public.customers WHERE id = p_customer_id), 'Unknown'),
            COALESCE(NULLIF(trim(p_phone),''), (SELECT phone FROM public.customers WHERE id = p_customer_id), ''), NULLIF(trim(p_phone),''), p_text,
            CASE p_type WHEN 'service' THEN 'Service / repair' WHEN 'move' THEN 'Move unit' ELSE 'New sale' END,
            'pending', 'manual', (CASE WHEN p_type = 'service' THEN 'service' ELSE 'sales' END)::public.lead_intent, p_customer_id, v_co, v_uid, p_area,
            COALESCE((SELECT address FROM public.customers WHERE id = p_customer_id), NULLIF(trim(p_area),''), 'Not given'),
            COALESCE((SELECT latitude FROM public.customers WHERE id = p_customer_id), 0), COALESCE((SELECT longitude FROM public.customers WHERE id = p_customer_id), 0))
    RETURNING id INTO v_lead;
    PERFORM set_config('fl.request_type', '', true);
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
      -- the lead itself goes to that rep only (no open offer). Only while nobody has it and it is still open.
      IF r.lead_id IS NOT NULL THEN
        UPDATE public.leads SET assigned_agent_id = v_rep, assignment_method = 'owner_rep', accepted_at = COALESCE(accepted_at, now()),
               primary_intent = COALESCE(primary_intent, 'sales'::public.lead_intent)
         WHERE id = r.lead_id AND assigned_agent_id IS NULL AND closed_at IS NULL AND dismissed_at IS NULL;
      END IF;
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

-- Commission: label only. The money path (_snapshot_sales_commission, rep = quote's sales engineer) is untouched;
-- the owner rep holds the lead, so the quote and commission are theirs. Snapshots for a move lead get rule.attribution.
CREATE OR REPLACE FUNCTION public.trg_commission_move_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.quotes q JOIN public.requests r ON r.lead_id = q.lead_id WHERE q.id = NEW.quote_id AND r.type = 'move') THEN
    NEW.rule := COALESCE(NEW.rule, '{}'::jsonb) || jsonb_build_object('attribution', 'Move · internal sale');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_commission_move_label ON public.sales_commission_snapshots;
CREATE TRIGGER trg_commission_move_label BEFORE INSERT OR UPDATE ON public.sales_commission_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.trg_commission_move_label();
