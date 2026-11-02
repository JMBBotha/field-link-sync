-- Stock from supplier invoices + bulk-material draw-down.            NOT APPLIED: needs Johan's OK.
--  * cf_stock_items gets a catalogue link and a stock unit (each|m|kg|l|roll) with pack_size
--    (stock units per purchased pack: 15 m coil, 11.3 kg cylinder, box of 100 …).
--  * supplier_job_document_lines get cost + receiving columns.
--  * sjd_receive(doc, lines)     admin only (_cf_ok). Invoice adds stock; delivery note records cost/intent only.
--  * job_materials_plan(job) / job_materials_draw(job, lines)   admin or a tech assigned to the job.
-- Additive only: new nullable columns + new functions. No existing function is changed.

ALTER TABLE public.cf_stock_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_unit text NOT NULL DEFAULT 'each' CHECK (stock_unit IN ('each','m','kg','l','roll')),
  ADD COLUMN IF NOT EXISTS pack_size numeric NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  ADD COLUMN IF NOT EXISTS last_received_at timestamptz;
CREATE INDEX IF NOT EXISTS cf_stock_items_product ON public.cf_stock_items(company_id, product_id);

ALTER TABLE public.supplier_job_document_lines
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_cost_excl numeric,           -- per purchased pack, as on the document (or catalogue)
  ADD COLUMN IF NOT EXISTS cost_source text CHECK (cost_source IN ('invoice','catalogue','none')),
  ADD COLUMN IF NOT EXISTS receive_action text CHECK (receive_action IN ('stock','reserve','installed','skip','pending')),
  ADD COLUMN IF NOT EXISTS receive_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_item_id uuid REFERENCES public.cf_stock_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_qty numeric,                -- stock units added (0 for delivery notes)
  ADD COLUMN IF NOT EXISTS price_flag text CHECK (price_flag IN ('warn','note')),
  ADD COLUMN IF NOT EXISTS price_note text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid;

ALTER TABLE public.job_materials_used ADD COLUMN IF NOT EXISTS quote_item_id uuid;

-- find-or-create the stock item for a line
CREATE OR REPLACE FUNCTION public._stock_item_for(p_company uuid, p_product uuid, p_model text, p_item text, p_unit text, p_pack numeric)
RETURNS public.cf_stock_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cf_stock_items;
BEGIN
  SELECT * INTO s FROM public.cf_stock_items
   WHERE company_id = p_company AND active AND nullif(p_model,'') IS NOT NULL
     AND upper(regexp_replace(coalesce(model_code,''), '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(p_model, '[^A-Za-z0-9]', '', 'g'))
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF s.id IS NULL AND p_product IS NOT NULL AND nullif(p_model,'') IS NULL THEN
    SELECT * INTO s FROM public.cf_stock_items WHERE company_id = p_company AND active AND product_id = p_product ORDER BY created_at LIMIT 1 FOR UPDATE;
  END IF;
  IF s.id IS NULL THEN
    INSERT INTO public.cf_stock_items (company_id, item, model_code, qty_on_hand, unit_cost_excl, product_id, stock_unit, pack_size)
    VALUES (p_company, left(coalesce(nullif(trim(p_item),''), p_model, 'Item'),160), nullif(p_model,''), 0, 0, p_product, coalesce(p_unit,'each'), coalesce(nullif(p_pack,0),1))
    RETURNING * INTO s;
  ELSIF s.product_id IS NULL AND p_product IS NOT NULL THEN
    UPDATE public.cf_stock_items SET product_id = p_product, stock_unit = coalesce(p_unit, stock_unit), pack_size = coalesce(nullif(p_pack,0), pack_size) WHERE id = s.id RETURNING * INTO s;
  END IF;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public._stock_item_for(uuid,uuid,text,text,text,numeric) FROM PUBLIC, anon, authenticated;

-- find-or-create the Projects line (cf_commitment) for a reserved unit on a job.
-- Uses the quote line's key 'q:<quote_item_id>' so cf_sync updates the same row instead of making a duplicate.
CREATE OR REPLACE FUNCTION public._reserve_commitment(p_job uuid, p_product uuid, p_item text, p_qty numeric, p_cost numeric, p_line uuid, p_supplier text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; q record; v_qi uuid; v_key text; v_id uuid;
BEGIN
  SELECT id, company_id, quote_id, title INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  SELECT id, quote_number, customer_name INTO q FROM public.quotes WHERE id = j.quote_id;
  IF q.id IS NOT NULL AND p_product IS NOT NULL THEN
    SELECT qi2.id INTO v_qi FROM public.quote_items qi2 WHERE qi2.quote_id = q.id AND qi2.product_id = p_product
      AND NOT EXISTS (SELECT 1 FROM public.cf_commitments c WHERE c.company_id = j.company_id AND c.source_key = 'q:' || qi2.id
                      AND c.qty <= coalesce((SELECT sum(a.qty) FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id), 0))
      ORDER BY qi2.id LIMIT 1;
  END IF;
  v_key := CASE WHEN v_qi IS NOT NULL THEN 'q:' || v_qi ELSE 'sjd:' || p_line END;
  INSERT INTO public.cf_commitments AS c (company_id, source_key, quote_id, job_id, project, item, kind, qty, supplier, unit_cost_excl, status, note)
  VALUES (j.company_id, v_key, q.id, j.id, coalesce(nullif(trim(coalesce(q.quote_number,'') || ' ' || coalesce(q.customer_name,'')),''), j.title, 'Job'),
          left(coalesce(p_item,'Unit'),120), 'unit', greatest(p_qty, 0.01), p_supplier, coalesce(p_cost,0), 'needed', 'Added by stock receiving')
  ON CONFLICT (company_id, source_key) DO UPDATE SET job_id = coalesce(c.job_id, excluded.job_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._reserve_commitment(uuid,uuid,text,numeric,numeric,uuid,text) FROM PUBLIC, anon, authenticated;

-- p_lines: [{line_id, action, job_id, product_id, model_code, item, stock_unit, pack_size, qty_packs, unit_cost_pack, cost_source, price_flag, price_note}]
CREATE OR REPLACE FUNCTION public.sjd_receive(p_document uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.supplier_job_documents; ln jsonb; l public.supplier_job_document_lines; s public.cf_stock_items;
  v_inv boolean; v_action text; v_job uuid; v_pack numeric; v_qty numeric; v_cost numeric; v_unit_cost numeric; v_com uuid; v_free numeric;
  n_stock int := 0; n_res int := 0; n_inst int := 0; n_skip int := 0; n_done int := 0; out jsonb := '[]'::jsonb; v_msg text;
BEGIN
  SELECT * INTO d FROM public.supplier_job_documents WHERE id = p_document FOR UPDATE;
  IF d.id IS NULL OR NOT public._cf_ok(d.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  v_inv := d.doc_type = 'supplier_invoice';
  IF d.doc_type NOT IN ('supplier_invoice','delivery_note') THEN RAISE EXCEPTION 'Only delivery notes and supplier invoices can be received'; END IF;

  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    SELECT * INTO l FROM public.supplier_job_document_lines WHERE id = (ln->>'line_id')::uuid AND document_id = d.id FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Line % is not on this document', ln->>'line_id'; END IF;
    IF l.received_at IS NOT NULL THEN n_done := n_done + 1; CONTINUE; END IF;           -- idempotent
    v_action := coalesce(ln->>'action','skip');
    v_job := nullif(ln->>'job_id','')::uuid;
    IF v_action IN ('reserve','installed') THEN
      IF v_job IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job AND company_id = d.company_id) THEN RAISE EXCEPTION 'Line %: pick a job of this company', l.line_no; END IF;
    END IF;
    v_pack := coalesce(nullif(ln->>'pack_size','')::numeric, 1);
    v_qty  := round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1) * v_pack, 3);
    v_cost := nullif(ln->>'unit_cost_pack','')::numeric;
    v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_pack, 4) END;
    s := NULL; v_msg := NULL;

    IF v_action = 'skip' THEN n_skip := n_skip + 1;
    ELSIF v_action = 'installed' THEN
      -- supplied straight to site: record on the job, never touches stock
      INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by)
      VALUES (d.company_id, v_job, left(coalesce(ln->>'item', l.description, l.model_number,'Item'),160), v_qty, NULL, false, 0,
              'Supplied direct: ' || coalesce(d.doc_number, 'supplier doc'), auth.uid());
      n_inst := n_inst + 1;
    ELSIF NOT v_inv THEN
      -- delivery note: no stock until the invoice; a reserve makes sure the Projects line exists
      IF v_action = 'reserve' THEN
        PERFORM public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1), v_cost, l.id, d.supplier_name);
        n_res := n_res + 1;
      ELSE v_action := 'pending'; n_stock := n_stock + 1; END IF;
      v_qty := 0;
    ELSE
      -- invoice: add stock at invoice cost (weighted average), then reserve if asked
      s := public._stock_item_for(d.company_id, nullif(ln->>'product_id','')::uuid, ln->>'model_code', coalesce(ln->>'item', l.description), ln->>'stock_unit', v_pack);
      UPDATE public.cf_stock_items SET
        unit_cost_excl = CASE WHEN v_unit_cost IS NULL THEN unit_cost_excl
                              WHEN qty_on_hand + v_qty <= 0 THEN v_unit_cost
                              ELSE round((qty_on_hand * coalesce(unit_cost_excl,0) + v_qty * v_unit_cost) / (qty_on_hand + v_qty), 4) END,
        qty_on_hand = qty_on_hand + v_qty, last_received_at = now(), updated_at = now()
      WHERE id = s.id;
      n_stock := n_stock + 1;
      IF v_action = 'reserve' THEN
        v_com := public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), v_qty, v_unit_cost, l.id, d.supplier_name);
        v_free := least(v_qty, (SELECT c.qty - coalesce((SELECT sum(a.qty) FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id AND a.drawn_at IS NULL),0)
                                 FROM public.cf_commitments c WHERE c.id = v_com));
        IF v_free > 0 AND (SELECT status FROM public.cf_commitments WHERE id = v_com) <> 'installed' THEN
          PERFORM public.cf_allocate_stock(v_com, s.id, v_free);
        ELSE v_msg := 'Projects line already covered or installed: left in free stock'; END IF;
        n_res := n_res + 1;
      END IF;
    END IF;

    UPDATE public.supplier_job_document_lines SET
      product_id = nullif(ln->>'product_id','')::uuid, unit_cost_excl = v_cost, cost_source = nullif(ln->>'cost_source',''),
      receive_action = v_action, receive_job_id = v_job, stock_item_id = s.id, stock_qty = CASE WHEN v_inv AND v_action IN ('stock','reserve') THEN v_qty ELSE 0 END,
      price_flag = nullif(ln->>'price_flag',''), price_note = concat_ws(' · ', nullif(ln->>'price_note',''), v_msg),
      received_at = now(), received_by = auth.uid()
    WHERE id = l.id;
    out := out || jsonb_build_object('line_id', l.id, 'action', v_action, 'stock_item_id', s.id, 'stock_qty', v_qty, 'note', v_msg);
  END LOOP;
  RETURN jsonb_build_object('stocked', n_stock, 'reserved', n_res, 'installed', n_inst, 'skipped', n_skip, 'already_received', n_done, 'lines', out);
END $$;
REVOKE ALL ON FUNCTION public.sjd_receive(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_receive(uuid, jsonb) TO authenticated;

-- ── Materials draw-down ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._job_stock_ok(p_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND (public._cf_ok(j.company_id)
           OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = j.id AND a.profile_id = auth.uid())));
$$;
REVOKE ALL ON FUNCTION public._job_stock_ok(uuid) FROM PUBLIC, anon;

-- What the quote says, the stock items it maps to, what was drawn and what is reserved. Costs are not returned (techs see this).
CREATE OR REPLACE FUNCTION public.job_materials_plan(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  IF NOT public._job_stock_ok(p_job) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id, quote_id INTO j FROM public.jobs WHERE id = p_job;
  RETURN jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('quote_item_id', qi.id, 'product_id', qi.product_id, 'item_name', qi.item_name, 'quantity', qi.quantity,
               'product', CASE WHEN sp.id IS NULL THEN NULL ELSE jsonb_build_object('product_code', sp.product_code, 'short_name', sp.short_name, 'name', sp.name,
                 'description', sp.description, 'price_per_unit_label', sp.price_per_unit_label, 'sold_in_length', sp.sold_in_length, 'unit_length', sp.unit_length) END)
               ORDER BY qi.id)
             FROM public.quote_items qi LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
             WHERE j.quote_id IS NOT NULL AND qi.quote_id = j.quote_id AND coalesce(sp.product_type,'') <> 'ac_unit'), '[]'::jsonb),
    'stock', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'product_id', s.product_id, 'item', s.item, 'qty_on_hand', s.qty_on_hand, 'stock_unit', s.stock_unit, 'pack_size', s.pack_size))
             FROM public.cf_stock_items s WHERE s.company_id = j.company_id AND s.active AND s.product_id IN
               (SELECT product_id FROM public.quote_items WHERE quote_id = j.quote_id)), '[]'::jsonb),
    'drawn', coalesce((SELECT jsonb_agg(jsonb_build_object('stock_item_id', u.stock_item_id, 'drawn_qty', u.drawn_qty))
             FROM public.job_materials_used u WHERE u.job_id = p_job AND u.stock_item_id IS NOT NULL AND u.drawn_qty > 0), '[]'::jsonb),
    'reserved', coalesce((SELECT jsonb_agg(jsonb_build_object('stock_item_id', a.stock_item_id, 'qty', a.qty))
             FROM public.cf_stock_allocations a JOIN public.cf_commitments c ON c.id = a.commitment_id WHERE c.job_id = p_job), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.job_materials_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_materials_plan(uuid) TO authenticated;

-- p_lines: [{stock_item_id, quote_item_id, qty}] in stock units (m, kg …). Tech-adjusted quantities.
-- Never draws below zero; never draws an item reserved on this job's Projects line (the install trigger does that).
CREATE OR REPLACE FUNCTION public.job_materials_draw(p_job uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; ln jsonb; s public.cf_stock_items; v_qty numeric; v_drawn numeric; v_note text; out jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._job_stock_ok(p_job) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id INTO j FROM public.jobs WHERE id = p_job;
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    v_qty := round(coalesce(nullif(ln->>'qty','')::numeric, 0), 3);
    IF v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO s FROM public.cf_stock_items WHERE id = (ln->>'stock_item_id')::uuid AND company_id = j.company_id FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Stock item not found'; END IF;
    v_note := NULL;
    IF EXISTS (SELECT 1 FROM public.cf_stock_allocations a JOIN public.cf_commitments c ON c.id = a.commitment_id WHERE a.stock_item_id = s.id AND c.job_id = p_job) THEN
      v_drawn := 0; v_note := 'Reserved for this job: drawn when installed';
    ELSE
      v_drawn := least(v_qty, greatest(s.qty_on_hand, 0));
      IF v_drawn < v_qty THEN v_note := 'Only ' || s.qty_on_hand || ' ' || s.stock_unit || ' on hand'; END IF;
      UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand - v_drawn, updated_at = now() WHERE id = s.id;
    END IF;
    INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by, quote_item_id)
    VALUES (j.company_id, p_job, s.item, v_qty, s.id, true, v_drawn, v_note, auth.uid(), nullif(ln->>'quote_item_id','')::uuid);
    out := out || jsonb_build_object('stock_item_id', s.id, 'qty', v_qty, 'drawn_qty', v_drawn, 'note', v_note);
  END LOOP;
  RETURN jsonb_build_object('lines', out);
END $$;
REVOKE ALL ON FUNCTION public.job_materials_draw(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_materials_draw(uuid, jsonb) TO authenticated;

-- UI/edge gate: may the caller receive stock for this company? (admin only, same rule as RLS)
CREATE OR REPLACE FUNCTION public.cf_can_receive(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public._cf_ok(p_company) $$;
REVOKE ALL ON FUNCTION public.cf_can_receive(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cf_can_receive(uuid) TO authenticated;
