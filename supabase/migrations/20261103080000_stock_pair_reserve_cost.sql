-- Reserving pair halves (indoor + outdoor) puts the full pair price on the one Projects line.
CREATE OR REPLACE FUNCTION public.sjd_receive(p_document uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.supplier_job_documents; ln jsonb; l public.supplier_job_document_lines; s public.cf_stock_items;
  v_inv boolean; v_action text; v_job uuid; v_pack numeric; v_qty numeric; v_cost numeric; v_unit_cost numeric; v_com uuid; v_free numeric; v_pair numeric;
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
    -- pair halves (indoor + outdoor = different model numbers, same product and job) share one Projects line:
    -- its cost is the full pair price (sum of one half of each model), never just the first half.
    IF v_action = 'reserve' THEN
      SELECT round(sum(c), 4) INTO v_pair FROM (
        SELECT DISTINCT ON (coalesce(nullif(l2.model_number,''), l2.id::text))
               nullif(x->>'unit_cost_pack','')::numeric / coalesce(nullif(x->>'pack_size','')::numeric, 1) AS c
        FROM jsonb_array_elements(p_lines) x
        JOIN public.supplier_job_document_lines l2 ON l2.id = (x->>'line_id')::uuid AND l2.document_id = d.id
        WHERE x->>'action' = 'reserve' AND x->>'job_id' = ln->>'job_id' AND x->>'product_id' = ln->>'product_id'
        ORDER BY coalesce(nullif(l2.model_number,''), l2.id::text), l2.line_no) h;
      IF v_pair IS NULL OR nullif(ln->>'product_id','') IS NULL THEN v_pair := v_unit_cost; END IF;
    END IF;
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
        PERFORM public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1), v_pair, l.id, d.supplier_name);
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
        v_com := public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), v_qty, v_pair, l.id, d.supplier_name);
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

