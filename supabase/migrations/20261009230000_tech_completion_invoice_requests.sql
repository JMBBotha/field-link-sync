-- Tech completion -> invoice request (Johan 23:11). Techs never create/see invoices (existing rh_tech_* policies kept).
CREATE TABLE IF NOT EXISTS public.invoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  job_id uuid,
  quote_id uuid,
  technician_id uuid,
  customer_name text,
  as_quoted boolean NOT NULL DEFAULT true,
  extra_items jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{product_id, name, qty}] no prices
  extra_hours numeric,
  note text,
  started_at timestamptz,
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed')),
  invoice_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_requests_one_pending ON public.invoice_requests(lead_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS invoice_requests_company_status ON public.invoice_requests(company_id, status);
ALTER TABLE public.invoice_requests ENABLE ROW LEVEL SECURITY;
-- Office (not sales reps) of the company read all; a tech reads own requests (no money in this table). Writes only via RPCs.
DROP POLICY IF EXISTS ir_office_read ON public.invoice_requests;
CREATE POLICY ir_office_read ON public.invoice_requests FOR SELECT TO authenticated
  USING (public.p4_co_ok(company_id) AND auth.uid() IS NOT NULL
         AND NOT public.is_field_tech_only(auth.uid()) AND NOT public.is_sales_rep(auth.uid())
         AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'dispatcher'::app_role)));
DROP POLICY IF EXISTS ir_tech_own_read ON public.invoice_requests;
CREATE POLICY ir_tech_own_read ON public.invoice_requests FOR SELECT TO authenticated
  USING (technician_id = auth.uid());
REVOKE ALL ON public.invoice_requests FROM anon;
GRANT SELECT ON public.invoice_requests TO authenticated;

-- Tech (or office) submits the completion details. Idempotent per lead while pending.
CREATE OR REPLACE FUNCTION public.submit_invoice_request(
  p_lead_id uuid, p_job_id uuid DEFAULT NULL, p_extra_items jsonb DEFAULT '[]'::jsonb,
  p_extra_hours numeric DEFAULT NULL, p_note text DEFAULT NULL,
  p_started_at timestamptz DEFAULT NULL, p_finished_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; v_job uuid; v_quote uuid; v_items jsonb; v_hours numeric;
  v_asq boolean; v_id uuid; v_note text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  v_job := COALESCE(p_job_id, (SELECT j.id FROM public.jobs j WHERE j.lead_id = l.id AND j.status <> 'cancelled' ORDER BY j.created_at DESC LIMIT 1));
  IF NOT public.can_log_overrun(v_uid, v_job, l.id) THEN RAISE EXCEPTION 'Not allowed for this job'; END IF;
  v_quote := COALESCE((SELECT j.quote_id FROM public.jobs j WHERE j.id = v_job),
    (SELECT q.id FROM public.quotes q WHERE q.lead_id = l.id AND q.status <> 'declined' AND q.superseded_by IS NULL
      ORDER BY (q.status = 'accepted') DESC, q.created_at DESC LIMIT 1));
  -- Sanitise extras: quantity + name only, never prices.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', CASE WHEN (e->>'product_id') ~* '^[0-9a-f-]{36}$' THEN e->>'product_id' END,
           'name', left(COALESCE(NULLIF(trim(e->>'name'),''),'Item'), 200),
           'qty', round(LEAST((e->>'qty')::numeric, 10000), 2))), '[]'::jsonb)
    INTO v_items
    FROM (SELECT e FROM jsonb_array_elements(COALESCE(p_extra_items,'[]'::jsonb)) e
           WHERE jsonb_typeof(e) = 'object' AND COALESCE((e->>'qty')::numeric, 0) > 0 LIMIT 50) s;
  v_hours := CASE WHEN p_extra_hours IS NULL OR p_extra_hours <= 0 THEN NULL ELSE round(LEAST(p_extra_hours, 100), 2) END;
  v_asq := jsonb_array_length(v_items) = 0 AND v_hours IS NULL;
  v_note := NULLIF(left(trim(COALESCE(p_note,'')), 2000), '');

  SELECT id INTO v_id FROM public.invoice_requests WHERE lead_id = l.id AND status = 'pending';
  IF v_id IS NULL THEN
    INSERT INTO public.invoice_requests (company_id, lead_id, job_id, quote_id, technician_id, customer_name, as_quoted,
      extra_items, extra_hours, note, started_at, finished_at)
    VALUES (l.company_id, l.id, v_job, v_quote, v_uid, l.customer_name, v_asq, v_items, v_hours, v_note,
      p_started_at, COALESCE(p_finished_at, now()))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.invoice_requests SET job_id = COALESCE(v_job, job_id), quote_id = COALESCE(v_quote, quote_id),
      technician_id = v_uid, as_quoted = v_asq, extra_items = v_items, extra_hours = v_hours, note = v_note,
      started_at = COALESCE(p_started_at, started_at), finished_at = COALESCE(p_finished_at, finished_at, now()), updated_at = now()
    WHERE id = v_id;
  END IF;

  -- Keep the office margin view (job_overruns) in step when something changed.
  IF NOT v_asq THEN
    INSERT INTO public.job_overruns (job_id, lead_id, created_by, actual_hours, extra_items, notes)
    VALUES (v_job, l.id, v_uid, NULL, v_items,
      left(concat_ws(' ', CASE WHEN v_hours IS NOT NULL THEN 'Extra time: ' || v_hours || ' h.' END, v_note), 1000));
  END IF;

  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    SELECT DISTINCT ur.user_id, 'invoice_request',
      CASE WHEN v_asq THEN 'Invoice request – as quoted' ELSE 'Invoice request – changes' END,
      COALESCE(l.customer_name,'Job') || CASE WHEN v_asq THEN ' was completed as quoted.' ELSE ' was completed with extra materials/time.' END,
      l.id, jsonb_build_object('lead_id', l.id, 'invoice_request_id', v_id)
    FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('admin','dispatcher') AND p.company_id = l.company_id AND NOT public.is_sales_rep(ur.user_id);
  EXCEPTION WHEN others THEN RAISE WARNING 'invoice_request notify skipped: %', SQLERRM; END;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_invoice_request(uuid,uuid,jsonb,numeric,text,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_invoice_request(uuid,uuid,jsonb,numeric,text,timestamptz,timestamptz) TO authenticated;

-- Fallback: every completion (also offline-synced ones) gets an "as quoted" request if none is pending/approved yet.
CREATE OR REPLACE FUNCTION public.trg_job_completion_invoice_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'completed' AND NOT EXISTS (
       SELECT 1 FROM public.invoice_requests r WHERE r.lead_id = NEW.lead_id AND r.status IN ('pending','approved')) THEN
    BEGIN
      INSERT INTO public.invoice_requests (company_id, lead_id, job_id, quote_id, technician_id, customer_name, as_quoted, finished_at)
      SELECT l.company_id, l.id, jj.id,
        COALESCE(jj.quote_id,
          (SELECT q.id FROM public.quotes q WHERE q.lead_id = l.id AND q.status <> 'declined' AND q.superseded_by IS NULL
            ORDER BY (q.status = 'accepted') DESC, q.created_at DESC LIMIT 1)),
        NEW.technician_id, l.customer_name, true, COALESCE(NEW.completed_at, now())
      FROM public.leads l
      LEFT JOIN LATERAL (SELECT j.id, j.quote_id FROM public.jobs j
         WHERE j.id = NEW.job_id OR (NEW.job_id IS NULL AND j.lead_id = l.id AND j.status <> 'cancelled')
         ORDER BY (j.id = NEW.job_id) DESC NULLS LAST, j.created_at DESC LIMIT 1) jj ON true
      WHERE l.id = NEW.lead_id;
    EXCEPTION WHEN others THEN RAISE WARNING 'invoice_request fallback skipped: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_job_completion_invoice_request ON public.job_completions;
CREATE TRIGGER trg_job_completion_invoice_request AFTER INSERT OR UPDATE OF status ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.trg_job_completion_invoice_request();

-- Office approves: reuse/create the DRAFT balance invoice, add extras at catalogue sell price. Never sends anything.
CREATE OR REPLACE FUNCTION public.approve_invoice_request(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); r public.invoice_requests%ROWTYPE; l public.leads%ROWTYPE; v_inv uuid; inv public.invoices%ROWTYPE;
  e jsonb; v_price numeric; v_qty numeric; v_desc text; v_rate numeric; v_sub numeric; v_lines jsonb := '[]'::jsonb; v_hr numeric;
BEGIN
  IF v_uid IS NULL OR public.is_field_tech_only(v_uid) OR public.is_sales_rep(v_uid)
     OR NOT (public.has_role(v_uid,'admin'::app_role) OR public.has_role(v_uid,'dispatcher'::app_role)) THEN
    RAISE EXCEPTION 'Only the office can approve invoice requests';
  END IF;
  SELECT * INTO r FROM public.invoice_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT public.p4_co_ok(r.company_id) THEN RAISE EXCEPTION 'Invoice request not found'; END IF;
  IF r.status = 'approved' THEN RETURN r.invoice_id; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request was dismissed'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = r.lead_id;

  -- 1) The existing draft balance invoice (same logic as job completion), else any open non-deposit invoice for the job.
  IF r.quote_id IS NOT NULL THEN v_inv := public._create_balance_invoice(r.quote_id); END IF;
  IF v_inv IS NULL THEN
    SELECT i.id INTO v_inv FROM public.invoices i
     WHERE (i.lead_id = r.lead_id OR (r.quote_id IS NOT NULL AND i.quote_id = r.quote_id))
       AND COALESCE(i.status,'') NOT IN ('void','cancelled') AND COALESCE(i.notes,'') NOT LIKE 'DEPOSIT%'
     ORDER BY (i.status = 'draft') DESC, i.created_at DESC LIMIT 1;
  END IF;
  -- 2) No quote/invoice at all: an empty draft for the office to fill.
  IF v_inv IS NULL THEN
    INSERT INTO public.invoices (lead_id, quote_id, agent_id, customer_id, customer_name, customer_phone, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes)
    VALUES (l.id, r.quote_id, v_uid, l.customer_id, COALESCE(l.customer_name,''), COALESCE(l.customer_phone,''), l.customer_address,
      public.generate_invoice_number(), 0, 15, 0, 0, CURRENT_DATE + 30, 'draft', '[]'::jsonb, r.company_id,
      'From invoice request (' || CASE WHEN r.as_quoted THEN 'as quoted' ELSE 'changes' END || ')')
    RETURNING id INTO v_inv;
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = v_inv;

  -- 3) Extras onto the draft at catalogue sell price (excl. VAT); free-text items at R0 flagged for pricing.
  IF NOT r.as_quoted THEN
    IF inv.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is already %, add the extras manually (or credit/re-issue)', inv.invoice_number, inv.status;
    END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(r.extra_items) LOOP
      v_qty := COALESCE((e->>'qty')::numeric, 0);
      CONTINUE WHEN v_qty <= 0;
      v_price := NULL;
      IF e->>'product_id' IS NOT NULL THEN
        SELECT o.sell_excl_vat INTO v_price FROM public.get_product_sell_options() o WHERE o.id = (e->>'product_id')::uuid;
      END IF;
      v_desc := 'Extra (tech): ' || COALESCE(e->>'name','Item') || CASE WHEN v_price IS NULL THEN ' – price needed' ELSE '' END;
      v_price := COALESCE(v_price, 0);
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_inv, v_desc, v_qty, v_price, round(v_qty * v_price, 2));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', v_qty, 'rate', v_price, 'amount', round(v_qty * v_price, 2)));
    END LOOP;
    IF r.extra_hours IS NOT NULL AND r.extra_hours > 0 THEN
      SELECT cs.default_hourly_rate INTO v_hr FROM public.company_settings cs WHERE cs.company_id = r.company_id
        ORDER BY cs.created_at DESC NULLS LAST LIMIT 1;
      v_hr := COALESCE(v_hr, 0);
      v_desc := 'Extra labour (tech): ' || r.extra_hours || ' h' || CASE WHEN v_hr = 0 THEN ' – rate needed' ELSE '' END;
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_inv, v_desc, r.extra_hours, v_hr, round(r.extra_hours * v_hr, 2));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', r.extra_hours, 'rate', v_hr, 'amount', round(r.extra_hours * v_hr, 2)));
    END IF;
    v_rate := COALESCE(inv.tax_rate, 15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_sub FROM public.invoice_items WHERE invoice_id = v_inv;
    UPDATE public.invoices SET line_items = COALESCE(line_items, '[]'::jsonb) || v_lines,
      subtotal = round(v_sub, 2), tax_amount = round(v_sub * v_rate / 100, 2), grand_total = round(v_sub * (1 + v_rate / 100), 2),
      notes = concat_ws(E'\n', notes, 'Tech extras added from invoice request ' || to_char(now(), 'YYYY-MM-DD') || ' – review prices before sending.'),
      updated_at = now()
    WHERE id = v_inv;
  END IF;

  UPDATE public.invoice_requests SET status = 'approved', invoice_id = v_inv, approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE id = r.id;
  RETURN v_inv;
END $$;
REVOKE ALL ON FUNCTION public.approve_invoice_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_invoice_request(uuid) TO authenticated;
