-- WALDA review of the three-bucket ledger. NOT applied by this change.
-- 1. Credit notes post a return movement (negative qty at the credited cost).
-- 2–4. Quantity posts on the first of the delivery note or the invoice. The matching line is linked.
--     The second document posts a cost variance only, never quantity again.
--     An invoice whose goods are not here yet is awaiting delivery and is left out of the stock count.
-- 5. The Projects reservation is created only by the document that posts the quantity.
-- Rollback: the drops added to supabase/rollbacks/20261105140000_stock_three_buckets_rollback.sql

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('receive','allocate','use','adjust','return'));
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS value_adjust numeric NOT NULL DEFAULT 0;
ALTER TABLE public.stock_movements ALTER COLUMN unit_cost_excl DROP NOT NULL;
ALTER TABLE public.stock_units ALTER COLUMN unit_cost_excl DROP NOT NULL;

ALTER TABLE public.supplier_job_document_lines
  ADD COLUMN IF NOT EXISTS matched_line_id uuid REFERENCES public.supplier_job_document_lines(id),
  ADD COLUMN IF NOT EXISTS credits_line_id uuid REFERENCES public.supplier_job_document_lines(id),
  ADD COLUMN IF NOT EXISTS posts_qty boolean,
  ADD COLUMN IF NOT EXISTS delivered_with_doc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_missing boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS sjdl_one_match ON public.supplier_job_document_lines(matched_line_id) WHERE matched_line_id IS NOT NULL;

COMMENT ON COLUMN public.supplier_job_document_lines.matched_line_id IS
  'The earlier delivery-note or invoice line that already posted this quantity. This line changes cost only.';
COMMENT ON COLUMN public.supplier_job_document_lines.cost_missing IS
  'No cost on the line. Stock quantity still counts. The cost is not stored as zero.';

-- True when this movement is in the countable on-hand stock (monthly count and stock value).
CREATE OR REPLACE FUNCTION public.stock_qty_counts(p_kind text, p_doc uuid, p_line uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_kind = 'receive' AND EXISTS (
      SELECT 1 FROM public.supplier_job_documents d WHERE d.id = p_doc AND d.doc_type = 'supplier_invoice'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.supplier_job_document_lines l WHERE l.id = p_line AND l.delivered_with_doc
    ) AND NOT EXISTS (
      SELECT 1 FROM public.supplier_job_document_lines dn
      JOIN public.supplier_job_documents dd ON dd.id = dn.document_id
      WHERE dn.matched_line_id = p_line AND dd.doc_type = 'delivery_note' AND dn.received_at IS NOT NULL
    ) THEN false
    WHEN p_kind = 'return' AND EXISTS (
      SELECT 1 FROM public.supplier_job_document_lines cr
      JOIN public.supplier_job_document_lines src ON src.id = cr.credits_line_id
      JOIN public.supplier_job_documents sd ON sd.id = src.document_id
      WHERE cr.id = p_line AND sd.doc_type = 'supplier_invoice' AND NOT src.delivered_with_doc
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_job_document_lines dn
          JOIN public.supplier_job_documents dd ON dd.id = dn.document_id
          WHERE dn.matched_line_id = src.id AND dd.doc_type = 'delivery_note' AND dn.received_at IS NOT NULL
        )
    ) THEN false
    ELSE true
  END;
$$;
REVOKE ALL ON FUNCTION public.stock_qty_counts(text, uuid, uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public._stock_model_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'P$', ''), '');
$$;

-- BTU size. A trailing measure (12M, 12KG, 15MTR) is not a unit size. 24K still is.
CREATE OR REPLACE FUNCTION public.stock_unit_size_key(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (
    SELECT (regexp_match(upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g')),
            '(?:^|[^0-9])(36000|24000|18000|12000|9000|36|24|18|12|9)([^0-9]{1,3}|$)')) AS x
  )
  SELECT CASE
    WHEN x IS NULL THEN NULL
    WHEN coalesce(x[2], '') ~ '^(MM|MTR|ML|KG|M|G|W|A)' THEN NULL
    WHEN x[1] IN ('36','36000') THEN '36000'
    WHEN x[1] IN ('24','24000') THEN '24000'
    WHEN x[1] IN ('18','18000') THEN '18000'
    WHEN x[1] IN ('12','12000') THEN '12000'
    WHEN x[1] IN ('9','9000') THEN '9000'
    ELSE NULL
  END
  FROM m;
$$;

-- Earlier line that already posted this quantity, same model, compatible PO. Credit notes can see a line already linked to its invoice.
CREATE OR REPLACE FUNCTION public._sjd_match_line(p_company uuid, p_doc_type text, p_po text, p_model text, p_explicit uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_key text := public._stock_model_key(p_model);
BEGIN
  IF p_explicit IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.supplier_job_document_lines l
     WHERE l.id = p_explicit AND l.company_id = p_company AND l.received_at IS NOT NULL AND l.posts_qty
       AND (p_doc_type = 'credit_note' OR NOT EXISTS (SELECT 1 FROM public.supplier_job_document_lines x WHERE x.matched_line_id = l.id))
  ) THEN RETURN p_explicit; END IF;
  IF v_key IS NULL THEN RETURN NULL; END IF;
  SELECT l.id INTO v_id
    FROM public.supplier_job_document_lines l
    JOIN public.supplier_job_documents d ON d.id = l.document_id
   WHERE l.company_id = p_company AND l.received_at IS NOT NULL AND coalesce(l.posts_qty, false)
     AND public._stock_model_key(l.model_number) = v_key
     AND (p_doc_type = 'credit_note' OR NOT EXISTS (SELECT 1 FROM public.supplier_job_document_lines x WHERE x.matched_line_id = l.id))
     AND (
       (p_doc_type = 'supplier_invoice' AND d.doc_type = 'delivery_note')
       OR (p_doc_type = 'delivery_note' AND d.doc_type = 'supplier_invoice')
       OR (p_doc_type = 'credit_note' AND d.doc_type IN ('delivery_note','supplier_invoice'))
     )
     AND (nullif(trim(p_po), '') IS NULL OR nullif(trim(d.po_number), '') IS NULL OR d.po_number = p_po)
   ORDER BY (d.po_number IS NOT DISTINCT FROM nullif(trim(p_po), '')) DESC, l.received_at
   LIMIT 1;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._sjd_match_line(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Keep null costs null. value_adjust books an invoice price difference without a second quantity.
CREATE OR REPLACE FUNCTION public._stock_move(
  p_company uuid, p_kind text, p_bucket text, p_item uuid, p_product uuid, p_label text,
  p_qty numeric, p_cost numeric, p_vat numeric, p_job uuid, p_doc uuid, p_line uuid,
  p_serial text, p_unit uuid, p_reason text, p_allowance uuid, p_count_line uuid, p_transfer uuid,
  p_value_adjust numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.stock_movements (
    company_id, kind, bucket, stock_item_id, product_id, item_label, qty, unit_cost_excl, value_adjust, vat_amount,
    job_id, supplier_document_id, supplier_document_line_id, serial_no, unit_id, reason, allowance_id, count_line_id, transfer_id, created_by
  ) VALUES (
    p_company, p_kind, p_bucket, p_item, p_product, left(coalesce(nullif(trim(p_label),''), 'Item'), 160),
    p_qty, p_cost, coalesce(p_value_adjust, 0), p_vat, p_job, p_doc, p_line, nullif(trim(p_serial), ''), p_unit,
    nullif(trim(p_reason), ''), p_allowance, p_count_line, p_transfer, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._stock_move(uuid,text,text,uuid,uuid,text,numeric,numeric,numeric,uuid,uuid,uuid,text,uuid,text,uuid,uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._stock_move(
  p_company uuid, p_kind text, p_bucket text, p_item uuid, p_product uuid, p_label text,
  p_qty numeric, p_cost numeric, p_vat numeric, p_job uuid, p_doc uuid, p_line uuid,
  p_serial text, p_unit uuid, p_reason text, p_allowance uuid, p_count_line uuid, p_transfer uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._stock_move(p_company, p_kind, p_bucket, p_item, p_product, p_label, p_qty, p_cost, p_vat, p_job, p_doc, p_line, p_serial, p_unit, p_reason, p_allowance, p_count_line, p_transfer, 0);
END $$;

CREATE OR REPLACE FUNCTION public.material_avg_cost(p_item uuid, p_as_of timestamptz DEFAULT now())
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN coalesce(sum(qty) FILTER (WHERE unit_cost_excl IS NOT NULL AND public.stock_qty_counts(kind, supplier_document_id, supplier_document_line_id)), 0) <> 0
    THEN round((
      coalesce(sum(qty * unit_cost_excl) FILTER (WHERE unit_cost_excl IS NOT NULL AND public.stock_qty_counts(kind, supplier_document_id, supplier_document_line_id)), 0)
      + coalesce(sum(value_adjust) FILTER (WHERE public.stock_qty_counts(kind, supplier_document_id, supplier_document_line_id)), 0)
    ) / sum(qty) FILTER (WHERE unit_cost_excl IS NOT NULL AND public.stock_qty_counts(kind, supplier_document_id, supplier_document_line_id)), 4)
    ELSE (
      SELECT m.unit_cost_excl FROM public.stock_movements m
       WHERE m.stock_item_id = p_item AND m.bucket = 'material_pool' AND m.unit_cost_excl IS NOT NULL
         AND m.created_at <= coalesce(p_as_of, now())
       ORDER BY m.created_at DESC LIMIT 1
    )
  END
  FROM public.stock_movements
  WHERE stock_item_id = p_item AND bucket = 'material_pool' AND created_at <= coalesce(p_as_of, now());
$$;

-- Quantity on the first document. The match posts cost only. Credit notes reverse.
CREATE OR REPLACE FUNCTION public.sjd_receive(p_document uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.supplier_job_documents; ln jsonb; l public.supplier_job_document_lines; s public.cf_stock_items;
  v_action text; v_job uuid; v_pack numeric; v_qty numeric; v_cost numeric; v_unit_cost numeric; v_com uuid; v_free numeric; v_pair numeric;
  v_bucket text; v_ptype text; v_vat_rate numeric; v_vat numeric; v_half text; v_serial text; v_code text;
  v_n int; v_i int; v_unit uuid; v_one text; v_part numeric;
  v_match uuid; v_taken uuid; v_delivered boolean; v_credit boolean; v_posts boolean; v_link uuid; v_credit_link uuid;
  v_old_cost numeric; v_old_qty numeric; v_delta numeric; v_count_now boolean; v_add numeric; v_src_bucket text; v_src_item uuid; v_src_unit uuid;
  n_stock int := 0; n_res int := 0; n_inst int := 0; n_skip int := 0; n_done int := 0; n_cost int := 0; n_ret int := 0;
  out jsonb := '[]'::jsonb; v_msg text; v_missing boolean;
BEGIN
  PERFORM public._stock_reject_bot();
  SELECT * INTO d FROM public.supplier_job_documents WHERE id = p_document FOR UPDATE;
  IF d.id IS NULL OR NOT public._cf_ok(d.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  v_credit := d.doc_type = 'credit_note';
  IF d.doc_type NOT IN ('supplier_invoice','delivery_note','credit_note') THEN RAISE EXCEPTION 'Only delivery notes, supplier invoices and credit notes can be received'; END IF;

  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    SELECT * INTO l FROM public.supplier_job_document_lines WHERE id = (ln->>'line_id')::uuid AND document_id = d.id FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Line % is not on this document', ln->>'line_id'; END IF;
    IF l.received_at IS NOT NULL THEN n_done := n_done + 1; CONTINUE; END IF;
    v_action := coalesce(ln->>'action','skip');
    v_job := nullif(ln->>'job_id','')::uuid;
    v_ptype := NULL;
    IF nullif(ln->>'product_id','') IS NOT NULL THEN
      SELECT product_type INTO v_ptype FROM public.supplier_products WHERE id = (ln->>'product_id')::uuid;
    END IF;
    v_bucket := nullif(ln->>'bucket','');
    IF v_bucket IS NOT NULL AND v_bucket NOT IN ('material_pool','job_unit','general_unit') THEN
      RAISE EXCEPTION 'Line %: unknown bucket', l.line_no;
    END IF;
    IF v_bucket IS NULL THEN
      IF v_action IN ('reserve','installed') THEN
        v_bucket := CASE WHEN v_ptype = 'ac_unit' OR (v_ptype IS NULL AND coalesce(ln->>'stock_unit','each') = 'each') THEN 'job_unit' ELSE 'material_pool' END;
      ELSIF v_action = 'stock' THEN
        v_bucket := CASE WHEN v_ptype = 'ac_unit' THEN 'general_unit' ELSE 'material_pool' END;
      END IF;
    END IF;
    IF v_ptype IS NOT NULL AND v_ptype IS DISTINCT FROM 'ac_unit' THEN v_bucket := 'material_pool'; END IF;
    IF coalesce(ln->>'stock_unit','each') <> 'each' AND v_ptype IS DISTINCT FROM 'ac_unit' THEN v_bucket := 'material_pool'; END IF;
    IF v_bucket = 'material_pool' THEN
      v_job := NULL;
      IF v_action IN ('reserve','installed') THEN v_action := 'stock'; END IF;
    ELSIF v_bucket = 'general_unit' THEN
      v_job := NULL;
      IF v_action <> 'skip' THEN v_action := 'stock'; END IF;
    ELSIF v_bucket = 'job_unit' AND v_action = 'stock' THEN
      v_action := 'reserve';
    END IF;
    IF v_action IN ('reserve','installed') THEN
      IF v_job IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job AND company_id = d.company_id) THEN
        RAISE EXCEPTION 'Line %: pick a job of this company', l.line_no;
      END IF;
    END IF;

    v_pack := coalesce(nullif(ln->>'pack_size','')::numeric, 1);
    v_qty  := round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1) * v_pack, 3);
    v_cost := nullif(ln->>'unit_cost_pack','')::numeric;
    v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_pack, 4) END;
    v_missing := v_unit_cost IS NULL AND v_action <> 'skip';
    v_vat_rate := coalesce(nullif(ln->>'vat_rate','')::numeric, 15);
    IF v_vat_rate < 0 OR v_vat_rate > 30 THEN v_vat_rate := 15; END IF;
    v_vat := nullif(ln->>'vat_amount','')::numeric;
    IF v_vat IS NULL AND v_cost IS NOT NULL THEN
      v_vat := round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1) * v_cost * v_vat_rate / 100.0, 2);
    END IF;
    v_code := upper(regexp_replace(coalesce(ln->>'model_code', l.model_number, ''), '[^A-Za-z0-9]', '', 'g'));
    v_half := nullif(ln->>'half','');
    IF v_half IS NOT NULL AND v_half NOT IN ('indoor','outdoor') THEN v_half := NULL; END IF;
    IF v_half IS NULL AND v_bucket IN ('job_unit','general_unit') THEN
      v_half := CASE
        WHEN v_code ~ '^AR[0-9].*[A-Z]X$' THEN 'outdoor'
        WHEN v_code ~ '^AR[0-9].*[A-Z]N$' THEN 'indoor'
        WHEN v_code ~ '[0-9]X$' THEN 'outdoor'
        WHEN v_ptype = 'ac_unit' THEN 'indoor'
        ELSE NULL
      END;
    END IF;
    v_serial := nullif(trim(coalesce(ln->>'serial_no', l.serial_number)), '');
    v_delivered := coalesce((ln->>'delivered')::boolean, false);
    v_posts := false; v_link := NULL; v_credit_link := NULL; v_msg := NULL; s := NULL; v_add := 0;
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

    IF v_action <> 'skip' AND v_action <> 'installed' THEN
      v_match := public._sjd_match_line(d.company_id, d.doc_type, d.po_number, coalesce(ln->>'model_code', l.model_number), nullif(ln->>'match_line_id','')::uuid);
      v_taken := NULL;
      IF v_match IS NULL AND NOT v_credit AND public._stock_model_key(coalesce(ln->>'model_code', l.model_number)) IS NOT NULL THEN
        SELECT l2.id INTO v_taken
          FROM public.supplier_job_document_lines l2
          JOIN public.supplier_job_documents d2 ON d2.id = l2.document_id
         WHERE l2.company_id = d.company_id AND coalesce(l2.posts_qty, false) AND l2.received_at IS NOT NULL
           AND public._stock_model_key(l2.model_number) = public._stock_model_key(coalesce(ln->>'model_code', l.model_number))
           AND EXISTS (
             SELECT 1 FROM public.supplier_job_document_lines x
             JOIN public.supplier_job_documents dx ON dx.id = x.document_id
             WHERE x.matched_line_id = l2.id AND dx.doc_type = d.doc_type)
           AND (nullif(trim(d.po_number),'') IS NULL OR nullif(trim(d2.po_number),'') IS NULL OR d2.po_number = d.po_number)
         LIMIT 1;
      END IF;
    ELSE
      v_match := NULL; v_taken := NULL;
    END IF;

    IF v_action = 'skip' THEN n_skip := n_skip + 1;
    ELSIF v_action = 'installed' THEN
      INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by)
      VALUES (d.company_id, v_job, left(coalesce(ln->>'item', l.description, l.model_number,'Item'),160), v_qty, NULL, false, 0,
              'Supplied direct: ' || coalesce(d.doc_number, 'supplier doc'), auth.uid());
      n_inst := n_inst + 1;
    ELSIF v_credit THEN
      s := public._stock_item_for(d.company_id, nullif(ln->>'product_id','')::uuid, ln->>'model_code', coalesce(ln->>'item', l.description), ln->>'stock_unit', v_pack);
      v_src_bucket := v_bucket; v_src_item := s.id; v_src_unit := NULL; v_old_cost := NULL;
      IF v_match IS NOT NULL THEN
        SELECT m.bucket, m.stock_item_id, m.unit_id, m.unit_cost_excl INTO v_src_bucket, v_src_item, v_src_unit, v_old_cost
          FROM public.stock_movements m
         WHERE m.supplier_document_line_id = v_match AND m.kind = 'receive'
         ORDER BY m.created_at LIMIT 1;
        v_credit_link := v_match;
        IF v_unit_cost IS NULL THEN v_unit_cost := v_old_cost; END IF;
        IF v_src_bucket IS NOT NULL THEN v_bucket := v_src_bucket; END IF;
        IF v_src_item IS NOT NULL THEN s.id := v_src_item; END IF;
      END IF;
      v_add := -abs(v_qty);
      PERFORM public._stock_move(d.company_id, 'return', coalesce(v_bucket, 'material_pool'), coalesce(v_src_item, s.id), nullif(ln->>'product_id','')::uuid,
        coalesce(ln->>'item', l.description, ln->>'model_code'), v_add, v_unit_cost, v_vat, v_job, d.id, l.id, v_serial, v_src_unit,
        'Credit note ' || coalesce(d.doc_number, ''), NULL, NULL, NULL);
      v_count_now := v_credit_link IS NULL OR public.stock_qty_counts('receive', (SELECT document_id FROM public.supplier_job_document_lines WHERE id = v_credit_link), v_credit_link);
      IF v_count_now THEN
        UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand + v_add), updated_at = now() WHERE id = coalesce(v_src_item, s.id);
      END IF;
      v_qty := v_add; n_ret := n_ret + 1;
      IF v_unit_cost IS NULL THEN v_missing := true; v_msg := 'Credit has no cost; quantity reversed, cost left unknown'; END IF;
    ELSIF v_match IS NOT NULL THEN
      SELECT coalesce(sum(m.qty), 0) INTO v_old_qty
        FROM public.stock_movements m
       WHERE m.supplier_document_line_id = v_match AND m.kind = 'receive';
      SELECT m.unit_cost_excl, m.bucket, m.stock_item_id INTO v_old_cost, v_src_bucket, v_src_item
        FROM public.stock_movements m
       WHERE m.supplier_document_line_id = v_match AND m.kind = 'receive'
       ORDER BY m.created_at LIMIT 1;
      v_link := v_match;
      v_bucket := coalesce(v_src_bucket, v_bucket);
      IF v_old_qty <> v_qty THEN
        v_msg := 'Quantity on the first document is ' || v_old_qty || '. This document does not change it.';
      ELSE
        v_msg := 'Matched the first document. Cost only, quantity unchanged.';
      END IF;
      IF v_unit_cost IS NOT NULL AND v_old_cost IS NOT NULL AND abs(v_unit_cost - v_old_cost) > 0.0001 THEN
        v_delta := round(v_old_qty * (v_unit_cost - v_old_cost), 4);
        PERFORM public._stock_move(d.company_id, 'adjust', coalesce(v_bucket,'material_pool'), v_src_item, nullif(ln->>'product_id','')::uuid,
          coalesce(ln->>'item', l.description, ln->>'model_code'), 0, v_unit_cost, NULL,
          CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, d.id, l.id, NULL, NULL,
          'Invoice cost variance', NULL, NULL, NULL, v_delta);
        IF v_src_item IS NOT NULL AND v_bucket = 'material_pool' THEN
          UPDATE public.cf_stock_items SET unit_cost_excl = public.material_avg_cost(id, now()), updated_at = now() WHERE id = v_src_item;
        END IF;
      ELSIF v_unit_cost IS NULL THEN
        v_missing := true; v_msg := concat_ws(' · ', v_msg, 'No cost on this document');
      END IF;
      -- A delivery note releases an invoiced-but-not-delivered quantity into the count.
      IF d.doc_type = 'delivery_note' AND v_src_item IS NOT NULL AND NOT public.stock_qty_counts('receive', (SELECT document_id FROM public.supplier_job_document_lines WHERE id = v_match), v_match) THEN
        -- The link is written below; the count sees it after received_at is set. Bump the cache now.
        UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand + v_old_qty, updated_at = now() WHERE id = v_src_item;
      END IF;
      v_qty := 0; n_cost := n_cost + 1;
    ELSIF v_taken IS NOT NULL THEN
      v_msg := 'This quantity was already matched to another document. No further quantity posted.';
      v_qty := 0; n_cost := n_cost + 1;
    ELSE
      v_posts := true;
      v_count_now := d.doc_type = 'delivery_note' OR v_delivered OR v_credit;
      s := public._stock_item_for(d.company_id, nullif(ln->>'product_id','')::uuid, ln->>'model_code', coalesce(ln->>'item', l.description), ln->>'stock_unit', v_pack);
      v_add := v_qty;
      UPDATE public.cf_stock_items SET
        unit_cost_excl = CASE
          WHEN v_unit_cost IS NULL THEN unit_cost_excl
          WHEN v_bucket <> 'material_pool' THEN v_unit_cost
          WHEN unit_cost_excl IS NULL OR qty_on_hand + CASE WHEN v_count_now THEN v_add ELSE 0 END <= 0 THEN v_unit_cost
          ELSE round((qty_on_hand * unit_cost_excl + v_add * v_unit_cost) / (qty_on_hand + v_add), 4) END,
        qty_on_hand = CASE WHEN v_count_now THEN qty_on_hand + v_add ELSE qty_on_hand END,
        last_received_at = now(), updated_at = now()
      WHERE id = s.id;
      n_stock := n_stock + 1;
      IF v_action = 'reserve' AND v_bucket = 'job_unit' THEN
        v_com := public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), v_qty, coalesce(v_pair, v_unit_cost, 0), l.id, d.supplier_name);
        IF v_count_now THEN
          v_free := least(v_qty, (SELECT c.qty - coalesce((SELECT sum(a.qty) FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id AND a.drawn_at IS NULL),0)
                                   FROM public.cf_commitments c WHERE c.id = v_com));
          IF v_free > 0 AND (SELECT status FROM public.cf_commitments WHERE id = v_com) <> 'installed' THEN
            PERFORM public.cf_allocate_stock(v_com, s.id, v_free);
          ELSE v_msg := 'Projects line already covered or installed: left in free stock'; END IF;
        END IF;
        n_res := n_res + 1;
      END IF;
      IF v_bucket IN ('job_unit','general_unit') THEN
        v_n := greatest(1, round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1))::int);
        IF v_n > 50 THEN RAISE EXCEPTION 'Line %: receive at most 50 units on one line', l.line_no; END IF;
        FOR v_i IN 1..v_n LOOP
          v_one := CASE WHEN v_n = 1 THEN v_serial WHEN v_serial IS NULL THEN NULL ELSE nullif(trim((string_to_array(v_serial, ','))[v_i]), '') END;
          v_part := CASE WHEN v_vat IS NULL OR v_n = 0 THEN NULL ELSE round(v_vat / v_n, 2) END;
          INSERT INTO public.stock_units (
            company_id, stock_item_id, product_id, supplier_code, half, serial_no, origin, received_job_id,
            unit_cost_excl, vat_amount, supplier_document_id, supplier_document_line_id
          ) VALUES (
            d.company_id, s.id, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', l.model_number), v_half, v_one,
            CASE WHEN v_bucket = 'job_unit' THEN 'job_received' ELSE 'general_stock' END,
            CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END,
            v_unit_cost, v_part, d.id, l.id
          ) RETURNING id INTO v_unit;
          PERFORM public._stock_move(
            d.company_id, 'receive', v_bucket, s.id, nullif(ln->>'product_id','')::uuid,
            coalesce(ln->>'item', l.description, ln->>'model_code'), 1, v_unit_cost, v_part,
            CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, d.id, l.id, v_one, v_unit,
            CASE WHEN v_missing THEN 'No cost' ELSE NULL END, NULL, NULL, NULL);
        END LOOP;
      ELSIF v_bucket = 'material_pool' THEN
        PERFORM public._stock_move(
          d.company_id, 'receive', 'material_pool', s.id, nullif(ln->>'product_id','')::uuid,
          coalesce(ln->>'item', l.description, ln->>'model_code'), v_qty, v_unit_cost, v_vat,
          NULL, d.id, l.id, NULL, NULL, CASE WHEN v_missing THEN 'No cost' ELSE NULL END, NULL, NULL, NULL);
      END IF;
      IF NOT v_count_now THEN v_msg := concat_ws(' · ', v_msg, 'Awaiting delivery: not in the stock count yet'); END IF;
      IF v_missing THEN v_msg := concat_ws(' · ', v_msg, 'No cost: not stored as zero'); END IF;
    END IF;

    UPDATE public.supplier_job_document_lines SET
      product_id = nullif(ln->>'product_id','')::uuid,
      model_number = coalesce(model_number, nullif(ln->>'model_code','')),
      unit_cost_excl = v_cost, cost_source = nullif(ln->>'cost_source',''),
      receive_action = v_action, receive_job_id = v_job, receive_bucket = v_bucket,
      stock_item_id = s.id,
      stock_qty = CASE WHEN v_posts OR v_credit THEN v_qty ELSE 0 END,
      posts_qty = v_posts, matched_line_id = v_link, credits_line_id = v_credit_link,
      delivered_with_doc = v_delivered, cost_missing = v_missing,
      vat_rate = v_vat_rate, vat_amount = v_vat,
      price_flag = CASE WHEN v_missing THEN 'warn' ELSE nullif(ln->>'price_flag','') END,
      price_note = concat_ws(' · ', nullif(ln->>'price_note',''), v_msg),
      received_at = now(), received_by = auth.uid()
    WHERE id = l.id;
    out := out || jsonb_build_object('line_id', l.id, 'action', v_action, 'bucket', v_bucket, 'stock_item_id', s.id, 'stock_qty', CASE WHEN v_posts OR v_credit THEN v_qty ELSE 0 END, 'posts_qty', v_posts, 'matched_line_id', v_link, 'vat_amount', v_vat, 'note', v_msg);
  END LOOP;
  RETURN jsonb_build_object('stocked', n_stock, 'reserved', n_res, 'installed', n_inst, 'skipped', n_skip, 'already_received', n_done, 'cost_only', n_cost, 'returned', n_ret, 'lines', out);
END $$;

CREATE OR REPLACE FUNCTION public.stock_value_as_of(p_company uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (bucket text, stock_item_id uuid, item_label text, qty numeric, value_excl numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._stock_accounts_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT m.bucket, m.stock_item_id, max(m.item_label),
         round(sum(m.qty), 3),
         round(sum(CASE WHEN m.unit_cost_excl IS NULL AND coalesce(m.value_adjust, 0) = 0 THEN NULL
                        ELSE coalesce(m.qty, 0) * coalesce(m.unit_cost_excl, 0) + coalesce(m.value_adjust, 0) END), 2)
    FROM public.stock_movements m
   WHERE m.company_id = p_company AND m.created_at <= coalesce(p_as_of, now())
     AND public.stock_qty_counts(m.kind, m.supplier_document_id, m.supplier_document_line_id)
   GROUP BY m.bucket, m.stock_item_id
   ORDER BY m.bucket, max(m.item_label);
END $$;

CREATE OR REPLACE VIEW public.stock_value_by_bucket
WITH (security_invoker = true) AS
SELECT m.company_id, m.bucket, m.stock_item_id,
       max(m.item_label) AS item_label,
       round(sum(m.qty), 3) AS qty,
       round(sum(CASE WHEN m.unit_cost_excl IS NULL AND coalesce(m.value_adjust,0) = 0 THEN NULL
                      ELSE coalesce(m.qty,0) * coalesce(m.unit_cost_excl,0) + coalesce(m.value_adjust,0) END), 2) AS value_excl
  FROM public.stock_movements m
 WHERE public.stock_qty_counts(m.kind, m.supplier_document_id, m.supplier_document_line_id)
 GROUP BY m.company_id, m.bucket, m.stock_item_id;

CREATE OR REPLACE VIEW public.job_stock_cost
WITH (security_invoker = true) AS
SELECT m.company_id, m.job_id,
  round(coalesce(sum(CASE WHEN public.stock_qty_counts(m.kind, m.supplier_document_id, m.supplier_document_line_id)
                            AND m.bucket = 'job_unit' AND m.kind IN ('receive','allocate','adjust')
                            AND (m.unit_cost_excl IS NOT NULL OR coalesce(m.value_adjust,0) <> 0)
                       THEN coalesce(m.qty,0) * coalesce(m.unit_cost_excl,0) + coalesce(m.value_adjust,0) ELSE 0 END), 0), 2) AS unit_cost_excl,
  round(coalesce(sum(CASE WHEN m.bucket = 'material_pool' AND m.kind = 'use' AND m.allowance_id IS NOT NULL AND m.unit_cost_excl IS NOT NULL
                       THEN -m.qty * m.unit_cost_excl ELSE 0 END), 0), 2) AS material_cost_excl
  FROM public.stock_movements m
 WHERE m.job_id IS NOT NULL
 GROUP BY m.company_id, m.job_id;

CREATE OR REPLACE FUNCTION public.stock_awaiting(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('item_label', m.item_label, 'qty', m.qty, 'doc_number', d.doc_number, 'line_id', m.supplier_document_line_id)
      ORDER BY d.doc_number, m.item_label)
    FROM public.stock_movements m
    JOIN public.supplier_job_documents d ON d.id = m.supplier_document_id
    WHERE m.company_id = p_company AND m.kind = 'receive' AND m.qty > 0
      AND NOT public.stock_qty_counts(m.kind, m.supplier_document_id, m.supplier_document_line_id)
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.stock_awaiting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_awaiting(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_count_save(p_company uuid, p_counted_on date, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; ln jsonb; v_sys numeric; v_item uuid; v_bucket text;
BEGIN
  PERFORM public._stock_reject_bot();
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.stock_counts (company_id, counted_on, status, created_by)
  VALUES (p_company, coalesce(p_counted_on, CURRENT_DATE), 'draft', auth.uid()) RETURNING id INTO v_id;
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_item := (ln->>'stock_item_id')::uuid;
    v_bucket := ln->>'bucket';
    IF NOT EXISTS (SELECT 1 FROM public.cf_stock_items WHERE id = v_item AND company_id = p_company) THEN
      RAISE EXCEPTION 'Stock item is not in this company';
    END IF;
    SELECT coalesce(sum(m.qty), 0) INTO v_sys FROM public.stock_movements m
     WHERE m.company_id = p_company AND m.stock_item_id = v_item AND m.bucket = v_bucket
       AND public.stock_qty_counts(m.kind, m.supplier_document_id, m.supplier_document_line_id);
    INSERT INTO public.stock_count_lines (count_id, company_id, stock_item_id, bucket, system_qty, counted_qty, reason)
    VALUES (v_id, p_company, v_item, v_bucket, round(v_sys, 3), round((ln->>'counted_qty')::numeric, 3), nullif(trim(ln->>'reason'), ''));
  END LOOP;
  RETURN v_id;
END $$;

-- Positive whole-number adjustments of general units get a stock_units row. Negative adjustments stay on the ledger (rows are not deleted).
CREATE OR REPLACE FUNCTION public.stock_post_adjust(
  p_company uuid, p_stock_item uuid, p_bucket text, p_qty numeric, p_reason text, p_count_line uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cf_stock_items; v_cost numeric; v_id uuid; i int;
BEGIN
  PERFORM public._stock_reject_bot();
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_bucket NOT IN ('material_pool','job_unit','general_unit') THEN RAISE EXCEPTION 'Unknown bucket'; END IF;
  IF coalesce(p_qty, 0) = 0 THEN RAISE EXCEPTION 'Adjustment quantity cannot be zero'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'An adjustment needs a reason'; END IF;
  SELECT * INTO s FROM public.cf_stock_items WHERE id = p_stock_item AND company_id = p_company FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stock item not found'; END IF;
  IF p_bucket = 'material_pool' THEN v_cost := public.material_avg_cost(s.id, now());
  ELSE
    SELECT m.unit_cost_excl INTO v_cost FROM public.stock_movements m
     WHERE m.stock_item_id = s.id AND m.bucket = p_bucket AND m.kind = 'receive' AND m.unit_cost_excl IS NOT NULL
     ORDER BY m.created_at DESC LIMIT 1;
  END IF;
  IF v_cost IS NULL THEN v_cost := NULLIF(s.unit_cost_excl, 0); END IF;
  v_id := public._stock_move(p_company, 'adjust', p_bucket, s.id, s.product_id, s.item,
    p_qty, v_cost, NULL, NULL, NULL, NULL, NULL, NULL, p_reason, NULL, p_count_line, NULL);
  UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand + p_qty), last_counted_at = now(), updated_at = now() WHERE id = s.id;
  IF p_bucket = 'general_unit' AND p_qty >= 1 AND p_qty <= 20 AND p_qty = trunc(p_qty) THEN
    FOR i IN 1..p_qty::int LOOP
      INSERT INTO public.stock_units (company_id, stock_item_id, product_id, supplier_code, origin, unit_cost_excl)
      VALUES (p_company, s.id, s.product_id, s.model_code, 'general_stock', v_cost);
    END LOOP;
  END IF;
  RETURN v_id;
END $$;

-- Installed units leave on-hand stock value. Job cost still counts the receipt.
CREATE OR REPLACE FUNCTION public.job_book_out_units(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; su record; v_cost numeric; v_var numeric; n int := 0;
BEGIN
  IF NOT public._job_stock_ok(p_job) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id INTO j FROM public.jobs WHERE id = p_job;
  FOR su IN
    SELECT u.* FROM public.stock_units u
     WHERE u.company_id = j.company_id
       AND (u.received_job_id = p_job OR EXISTS (
         SELECT 1 FROM public.stock_movements m WHERE m.unit_id = u.id AND m.job_id = p_job AND m.bucket = 'job_unit' AND m.kind = 'allocate' AND m.qty > 0))
       AND NOT EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.unit_id = u.id AND m.kind = 'use')
       AND coalesce((SELECT sum(m.qty) FROM public.stock_movements m WHERE m.unit_id = u.id AND m.bucket IN ('job_unit','general_unit') AND public.stock_qty_counts(m.kind, m.supplier_document_id, m.supplier_document_line_id)), 0) > 0
  LOOP
    SELECT m.unit_cost_excl INTO v_cost FROM public.stock_movements m WHERE m.unit_id = su.id AND m.kind = 'receive' ORDER BY m.created_at LIMIT 1;
    SELECT coalesce(sum(m.value_adjust), 0) INTO v_var FROM public.stock_movements m WHERE m.unit_id = su.id;
    IF v_cost IS NOT NULL THEN v_cost := v_cost + v_var; END IF;
    PERFORM public._stock_move(j.company_id, 'use', 'job_unit', su.stock_item_id, su.product_id, coalesce(su.supplier_code, 'Unit'),
      -1, v_cost, NULL, p_job, su.supplier_document_id, su.supplier_document_line_id, su.serial_no, su.id, 'Installed', NULL, NULL, NULL);
    UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - 1), updated_at = now() WHERE id = su.stock_item_id;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('booked_out', n);
END $$;
REVOKE ALL ON FUNCTION public.job_book_out_units(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_book_out_units(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_allowance_on_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    BEGIN
      PERFORM public.job_apply_material_allowances(NEW.id);
      PERFORM public.job_book_out_units(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'stock close not posted for job %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
