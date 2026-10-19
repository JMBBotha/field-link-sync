-- Cash-flow unit detection (Johan 19 Oct 2026 09:29 SAST): units to order = same rule as the quote builder
-- (src/lib/pricing.ts classifyQuoteCategory = 'units'), not product_type. Consumables typed correctly.
-- Rollback: docs/db-releases/2026-10-19_cf_unit_detection_rollback.sql

-- Mirrors src/lib/pricing.ts classifyQuoteCategory(): true only when the builder would class the line as "units".
CREATE OR REPLACE FUNCTION public._cf_is_unit_line(
  p_item_type text, p_name text, p_product_category text, p_category text,
  p_quote_category text, p_is_bundle boolean, p_product_code text, p_supplier_type text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $f$
DECLARE
  v_cat text := lower(coalesce(p_product_category,'') || ' ' || coalesce(p_category,'') || ' ' || coalesce(p_item_type,''));
  v_name text := lower(coalesce(p_name,''));
  v_strong boolean; v_acc boolean;
BEGIN
  IF v_cat ~ '\y(service|labour|labor)\y'
     OR v_name ~ '\y(labour|labor|installation labour|install(ation)? fee|service call|call[- ]?out|workmanship|fitment)\y' THEN
    RETURN false;
  END IF;
  IF p_quote_category IN ('units','materials') THEN RETURN p_quote_category = 'units'; END IF;
  IF NOT coalesce(p_is_bundle,false)
     AND trim(coalesce(nullif(p_product_category,''), p_item_type, '')) ~* '^(air conditioning|water heaters|batteries|inverters)$' THEN
    RETURN true;
  END IF;
  IF coalesce(p_is_bundle,false) OR v_cat ~ '(kit|consumable|material)' THEN RETURN false; END IF;
  v_strong := v_name ~ '\y(inv|inverter|indoor|outdoor|cassette|ducted|concealed|suspended|floor standing|rooftop|mw|wall ?mount|split|fixed speed|heat ?pump)\y';
  v_acc := v_name ~ '\y(pump|bolt|nail|disc|compound|washer|screw|tube|tubing|pipe|piping|copper|insulation|armaflex|tape|bracket|kit|cable|trunking|drain|gas|refrigerant|remote|controller|stand|pad|filter|clamp|duct)\y'
        OR v_name ~ '\y(knock|nails?|raw)\y|tube|\ye-ee\d';
  IF v_acc AND NOT v_strong THEN RETURN false; END IF;
  RETURN v_cat ~ '(air ?con|aircon|\yac\y|hvac|split|heat pump)'
      OR coalesce(p_supplier_type,'') IN ('ac_units','ac_equipment')
      OR v_strong
      OR (v_name || ' ' || lower(coalesce(p_product_code,''))) ~ '\d+\s*k?\s*btu';
END $f$;
REVOKE ALL ON FUNCTION public._cf_is_unit_line(text,text,text,text,text,boolean,text,text) FROM PUBLIC, anon, authenticated;

-- Invoice lines carry only a name: true for accessories/consumables (builder ACCESSORY_RE + panels/controllers) unless the name is clearly a unit.
CREATE OR REPLACE FUNCTION public._cf_name_is_accessory(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT (lower(coalesce(p_name,'')) ~ '\y(pump|bolt|nail|disc|compound|washer|screw|tube|tubing|pipe|piping|copper|insulation|armaflex|tape|bracket|kit|cable|trunking|drain|gas|refrigerant|remote|controller|stand|pad|filter|clamp|duct|panel|decoration|wi-?fi|dongle|cloud)\y'
          OR lower(coalesce(p_name,'')) ~ '\y(knock|nails?|raw)\y|tube|\ye-ee\d')
     AND lower(coalesce(p_name,'')) !~ '\y(inv|inverter|indoor|outdoor|cassette|ducted|concealed|suspended|floor standing|rooftop|mw|wall ?mount|split|fixed speed|heat ?pump)\y'
$f$;
REVOKE ALL ON FUNCTION public._cf_name_is_accessory(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._cf_sync_core(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.cf_settings; inv record; q record; ln record; poi record;
  v_paid numeric; v_left numeric; v_dep numeric; v_parts jsonb; pt jsonb; v_amt numeric; v_rec boolean;
  v_job_id uuid; v_job_date date; v_job_done boolean; v_base date; v_exp date; v_conf int; v_part text;
  v_dep_date date; v_has_po boolean; v_cost numeric; v_ord int; v_qty numeric; v_terms int;
  n_rec int := 0; n_com int := 0; v_vat numeric; v_dep_pct numeric; v_label text;
BEGIN
  PERFORM set_config('cf.sync', '1', true);
  INSERT INTO public.cf_settings (company_id, vat_number)
    VALUES (p_company, (SELECT cs.vat_number FROM public.company_settings cs WHERE cs.company_id = p_company ORDER BY cs.is_primary DESC NULLS LAST LIMIT 1))
    ON CONFLICT (company_id) DO NOTHING;
  SELECT * INTO s FROM public.cf_settings WHERE company_id = p_company;
  SELECT coalesce(max(cs.default_payment_terms_days), 0), coalesce(max(cs.default_deposit_percentage), 70)
    INTO v_terms, v_dep_pct FROM public.company_settings cs WHERE cs.company_id = p_company;

  -- void invoices: drop their synced rows
  DELETE FROM public.cf_receipts r USING public.invoices i WHERE r.company_id = p_company AND r.invoice_id = i.id AND r.source = 'field_lynk' AND i.status IN ('void','cancelled');
  DELETE FROM public.cf_commitments c USING public.invoices i WHERE c.company_id = p_company AND c.invoice_id = i.id AND c.source_key IS NOT NULL AND c.status = 'needed' AND i.status IN ('void','cancelled');

  FOR inv IN
    SELECT i.*, coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id AND coalesce(p.status,'paid') IN ('paid','completed','succeeded')), 0) AS paid_sum,
      (SELECT max(p.payment_date) FROM public.payments p WHERE p.invoice_id = i.id AND coalesce(p.status,'paid') IN ('paid','completed','succeeded')) AS last_paid
    FROM public.invoices i
    WHERE i.company_id = p_company AND i.status NOT IN ('void','cancelled')
      AND (i.status <> 'paid'
        OR EXISTS (SELECT 1 FROM public.jobs j WHERE (j.invoice_id = i.id OR (i.quote_id IS NOT NULL AND j.quote_id = i.quote_id)) AND j.status NOT IN ('completed','cancelled'))
        OR EXISTS (SELECT 1 FROM public.cf_receipts r WHERE r.invoice_id = i.id AND r.status = 'expected'))
  LOOP
    SELECT j.id, (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date, false INTO v_job_id, v_job_date, v_job_done
      FROM public.jobs j WHERE (j.invoice_id = inv.id OR (inv.quote_id IS NOT NULL AND j.quote_id = inv.quote_id)) AND j.status NOT IN ('completed','cancelled')
      ORDER BY j.scheduled_for NULLS LAST LIMIT 1;
    IF v_job_id IS NULL THEN
      v_job_done := EXISTS (SELECT 1 FROM public.jobs j WHERE (j.invoice_id = inv.id OR (inv.quote_id IS NOT NULL AND j.quote_id = inv.quote_id)) AND j.status = 'completed');
    END IF;

    v_label := coalesce(inv.invoice_number,'') || ' ' || coalesce(
      (SELECT nullif(trim(split_part(x->>'description', E'\n', 1)),'') FROM jsonb_array_elements(coalesce(inv.line_items,'[]'::jsonb)) x
        WHERE coalesce((x->>'amount')::numeric,0) = 0 AND coalesce(x->>'description','') ~* 'house|unit|site|block|flat|room' LIMIT 1),
      inv.customer_name, '');
    v_dep := CASE WHEN coalesce(inv.deposit_amount,0) > 0 AND inv.deposit_amount < inv.grand_total - 0.01 THEN round(inv.deposit_amount, 2) END;
    v_parts := CASE WHEN v_dep IS NULL THEN jsonb_build_array(jsonb_build_object('part','full','amt',inv.grand_total))
      ELSE jsonb_build_array(jsonb_build_object('part','deposit','amt',v_dep), jsonb_build_object('part','final','amt',round(inv.grand_total - v_dep, 2))) END;
    v_left := inv.paid_sum;
    v_base := CASE WHEN inv.status = 'draft' THEN current_date + 7 ELSE coalesce(inv.due_date, inv.issue_date + 7, current_date + 7) END;
    v_dep_date := NULL;

    FOR pt IN SELECT * FROM jsonb_array_elements(v_parts) LOOP
      v_part := pt->>'part'; v_amt := (pt->>'amt')::numeric;
      v_rec := v_left >= v_amt - 0.01; v_left := greatest(0, v_left - v_amt);
      v_exp := CASE WHEN v_part = 'final' THEN coalesce(v_job_date + v_terms, v_base + 30) ELSE v_base END;
      v_conf := CASE WHEN v_rec THEN 100
        WHEN v_part = 'final' AND NOT coalesce(v_job_done, false) THEN s.conf_final_before_install
        WHEN inv.status = 'draft' THEN s.conf_draft
        WHEN v_exp < current_date THEN s.conf_overdue ELSE s.conf_sent END;
      v_vat := CASE WHEN inv.grand_total > 0 THEN round(coalesce(inv.tax_amount,0) * v_amt / inv.grand_total, 2) ELSE 0 END;
      INSERT INTO public.cf_receipts AS r (company_id, source, source_key, invoice_id, quote_id, ref, client, part, amount_incl, vat_incl, expected_date, leeway_days, confidence, status, received_date, received_amount)
      VALUES (p_company, 'field_lynk', 'inv:' || inv.id || ':' || v_part, inv.id, inv.quote_id, coalesce(inv.invoice_number,''), inv.customer_name, v_part, v_amt, v_vat, v_exp, s.default_leeway_days, v_conf,
              CASE WHEN v_rec THEN 'received' ELSE 'expected' END, CASE WHEN v_rec THEN coalesce(inv.last_paid, inv.paid_date, current_date) END, CASE WHEN v_rec THEN v_amt END)
      ON CONFLICT (company_id, source_key) DO UPDATE SET
        amount_incl = excluded.amount_incl, vat_incl = excluded.vat_incl, ref = excluded.ref, client = excluded.client,
        status = CASE WHEN excluded.status = 'received' THEN 'received' WHEN r.status = 'received' THEN 'expected' ELSE r.status END,
        received_date = CASE WHEN excluded.status = 'received' THEN coalesce(r.received_date, excluded.received_date) END,
        received_amount = CASE WHEN excluded.status = 'received' THEN excluded.received_amount END,
        expected_date = CASE WHEN r.dates_edited THEN r.expected_date ELSE excluded.expected_date END,
        confidence = CASE WHEN excluded.status = 'received' THEN 100 WHEN r.conf_edited THEN r.confidence ELSE excluded.confidence END;
      n_rec := n_rec + 1;
      IF v_part IN ('deposit','full') THEN
        SELECT CASE WHEN r.status = 'received' THEN current_date ELSE r.expected_date END INTO v_dep_date FROM public.cf_receipts r
          WHERE r.company_id = p_company AND r.source_key = 'inv:' || inv.id || ':' || v_part;
      END IF;
    END LOOP;

    -- commitments: units still to buy (skip invoices whose install is done)
    IF NOT (v_job_id IS NULL AND coalesce(v_job_done,false)) THEN
      v_has_po := EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.invoice_id = inv.id AND po.status <> 'cancelled');
      IF v_has_po THEN
        FOR poi IN SELECT it.*, po.status AS po_status, coalesce(sp.trading_name, sp.name) AS sup_name
          FROM public.purchase_order_items it JOIN public.purchase_orders po ON po.id = it.po_id LEFT JOIN public.suppliers sp ON sp.id = po.supplier_id
          WHERE po.invoice_id = inv.id AND po.status <> 'cancelled' LOOP
          INSERT INTO public.cf_commitments AS c (company_id, source_key, invoice_id, quote_id, job_id, project, item, kind, qty, supplier, unit_cost_excl, status, pay_date)
          VALUES (p_company, 'po:' || poi.id, inv.id, inv.quote_id, v_job_id, v_label,
                  coalesce(nullif(trim(poi.model_code),''), nullif(trim(poi.description),''), 'Unit'), 'unit', greatest(coalesce(poi.qty,1), 0.01), trim(poi.sup_name), coalesce(poi.unit_cost_excl_vat, 0),
                  CASE WHEN poi.po_status = 'received' THEN 'in_stock' WHEN poi.po_status IN ('ordered','sent') THEN 'ordered_paid' ELSE 'needed' END, coalesce(v_dep_date, current_date))
          ON CONFLICT (company_id, source_key) DO UPDATE SET
            job_id = coalesce(excluded.job_id, c.job_id), project = excluded.project,
            qty = CASE WHEN c.edited THEN c.qty ELSE excluded.qty END,
            unit_cost_excl = CASE WHEN c.edited THEN c.unit_cost_excl ELSE excluded.unit_cost_excl END,
            pay_date = CASE WHEN c.edited THEN c.pay_date ELSE excluded.pay_date END,
            status = CASE WHEN c.status = 'needed' AND excluded.status <> 'needed' THEN excluded.status
                          WHEN c.status = 'ordered_paid' AND excluded.status = 'in_stock' THEN 'in_stock' ELSE c.status END;
          n_com := n_com + 1;
        END LOOP;
        -- a PO replaces the estimate from invoice lines
        DELETE FROM public.cf_commitments c WHERE c.company_id = p_company AND c.invoice_id = inv.id AND c.source_key LIKE 'inv:%' AND c.status = 'needed'
          AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id);
      ELSE
        v_ord := 0;
        FOR ln IN SELECT x, o FROM jsonb_array_elements(coalesce(inv.line_items,'[]'::jsonb)) WITH ORDINALITY AS t(x, o) LOOP
          v_ord := ln.o;
          IF (coalesce(ln.x->>'name','') || ' ' || coalesce(ln.x->>'description','')) ~* '(btu|inverter|wall ?mounted|split|cassette|ducted|samsung|midea|daikin|\mlg\M|mitsubishi|carrier|gree|hisense|alliance)'
             AND coalesce(ln.x->>'name','') !~* '(install|labour|labor|service|regas|re-gas|removal|remove|repair|kit|pipe|bracket|isolator|travel|callout|call-out|maintenance|clean)'
             AND coalesce((ln.x->>'amount')::numeric, 0) > 0
             AND NOT public._cf_name_is_accessory(ln.x->>'name') THEN
            v_qty := greatest(coalesce(nullif(ln.x->>'quantity','')::numeric, 1), 1);
            v_cost := round(coalesce(nullif(ln.x->>'rate','')::numeric, (ln.x->>'amount')::numeric / v_qty) * s.unit_cost_factor, 2);
            INSERT INTO public.cf_commitments AS c (company_id, source_key, invoice_id, quote_id, job_id, project, item, kind, qty, supplier, unit_cost_excl, status, pay_date)
            VALUES (p_company, 'inv:' || inv.id || ':' || v_ord, inv.id, inv.quote_id, v_job_id, v_label,
                    left(coalesce(substring(coalesce(ln.x->>'description','') from '([A-Z]{2}[0-9]{2}[A-Z0-9]+/?[A-Z]*)') || ' · ', '') || regexp_replace(coalesce(nullif(trim(ln.x->>'name'),''), 'Unit'), '^NEW\s+', '', 'i'), 120), 'unit', v_qty,
                    CASE WHEN (coalesce(ln.x->>'name','') || ' ' || coalesce(ln.x->>'description','')) ~* 'samsung' THEN 'Samsung / Fourways' ELSE NULL END, v_cost, 'needed', coalesce(v_dep_date, current_date))
            ON CONFLICT (company_id, source_key) DO UPDATE SET
              job_id = coalesce(excluded.job_id, c.job_id), project = excluded.project,
              qty = CASE WHEN c.edited THEN c.qty ELSE excluded.qty END,
              unit_cost_excl = CASE WHEN c.edited THEN c.unit_cost_excl ELSE excluded.unit_cost_excl END,
              pay_date = CASE WHEN c.edited THEN c.pay_date ELSE excluded.pay_date END,
              item = CASE WHEN c.edited THEN c.item ELSE excluded.item END;
            n_com := n_com + 1;
          ELSE
            -- line is not a unit (anymore): drop its untouched estimate
            DELETE FROM public.cf_commitments c WHERE c.company_id = p_company AND c.source_key = 'inv:' || inv.id || ':' || v_ord
              AND c.status = 'needed' AND NOT coalesce(c.edited, false)
              AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id);
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  -- accepted quotes not invoiced yet: expected deposit/final + units at cost
  DELETE FROM public.cf_receipts r WHERE r.company_id = p_company AND r.source_key LIKE 'q:%'
    AND (EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = r.quote_id AND i.status NOT IN ('void','cancelled'))
         OR NOT EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.id = r.quote_id AND qq.status = 'accepted'));
  DELETE FROM public.cf_commitments c WHERE c.company_id = p_company AND c.source_key LIKE 'q:%' AND c.status = 'needed'
    AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id)
    AND (EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = c.quote_id AND i.status NOT IN ('void','cancelled'))
         OR NOT EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.id = c.quote_id AND qq.status = 'accepted'));
  FOR q IN SELECT qq.* FROM public.quotes qq WHERE qq.company_id = p_company AND qq.status = 'accepted' AND coalesce(qq.is_variation, false) = false
      AND coalesce(qq.total, 0) > 0 AND qq.superseded_by IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = qq.id AND i.status NOT IN ('void','cancelled')) LOOP
    v_dep := round(q.total * v_dep_pct / 100, 2);
    v_base := greatest(current_date, coalesce((q.accepted_at AT TIME ZONE 'Africa/Johannesburg')::date, current_date) + 7);
    FOR pt IN SELECT * FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object('part','deposit','amt',v_dep), jsonb_build_object('part','final','amt',round(q.total - v_dep,2)))) LOOP
      v_part := pt->>'part'; v_amt := (pt->>'amt')::numeric;
      CONTINUE WHEN v_amt <= 0;
      INSERT INTO public.cf_receipts AS r (company_id, source, source_key, quote_id, ref, client, part, amount_incl, vat_incl, expected_date, leeway_days, confidence)
      VALUES (p_company, 'field_lynk', 'q:' || q.id || ':' || v_part, q.id, coalesce(q.quote_number,''), q.customer_name, v_part, v_amt,
              CASE WHEN q.total > 0 THEN round(coalesce(q.vat_amount,0) * v_amt / q.total, 2) ELSE 0 END,
              CASE WHEN v_part = 'final' THEN v_base + 30 ELSE v_base END, s.default_leeway_days,
              CASE WHEN v_part = 'final' THEN s.conf_final_before_install ELSE s.conf_draft END)
      ON CONFLICT (company_id, source_key) DO UPDATE SET amount_incl = excluded.amount_incl, vat_incl = excluded.vat_incl, ref = excluded.ref, client = excluded.client;
      n_rec := n_rec + 1;
    END LOOP;
    -- quote lines the builder does not class as units (consumables, kits, labour/installs): drop untouched estimates
    DELETE FROM public.cf_commitments c USING public.quote_items qi
      LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id LEFT JOIN public.suppliers su ON su.id = sp.supplier_id
      WHERE c.company_id = p_company AND c.source_key = 'q:' || qi.id AND qi.quote_id = q.id
        AND c.status = 'needed' AND NOT coalesce(c.edited, false)
        AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id)
        AND NOT public._cf_is_unit_line(qi.item_type, qi.item_name, sp.product_category, sp.category, qi.metadata->>'quote_category', qi.is_bundle, coalesce(qi.item_number, sp.product_code), su.supplier_type);
    -- units = same rule as the quote builder (src/lib/pricing.ts classifyQuoteCategory = 'units')
    FOR ln IN SELECT qi.*, sp.cost_excl_vat AS sp_cost, sp.brand AS sp_brand, sp.product_type AS sp_type
      FROM public.quote_items qi LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id LEFT JOIN public.suppliers su ON su.id = sp.supplier_id
      WHERE qi.quote_id = q.id
        AND public._cf_is_unit_line(qi.item_type, qi.item_name, sp.product_category, sp.category, qi.metadata->>'quote_category', qi.is_bundle, coalesce(qi.item_number, sp.product_code), su.supplier_type) LOOP
      INSERT INTO public.cf_commitments AS c (company_id, source_key, quote_id, project, item, kind, qty, supplier, unit_cost_excl, status, pay_date)
      VALUES (p_company, 'q:' || ln.id, q.id, coalesce(q.quote_number,'') || ' ' || coalesce(q.customer_name,''), left(coalesce(nullif(ln.item_number,''), ln.item_name, 'Unit'),120), 'unit',
              greatest(coalesce(ln.quantity,1), 0.01), coalesce(ln.supplier, ln.sp_brand),
              round(coalesce(nullif(ln.sp_cost,0), coalesce(ln.unit_price,0) * s.unit_cost_factor), 2), 'needed', v_base)
      ON CONFLICT (company_id, source_key) DO UPDATE SET
        qty = CASE WHEN c.edited THEN c.qty ELSE excluded.qty END,
        unit_cost_excl = CASE WHEN c.edited THEN c.unit_cost_excl ELSE excluded.unit_cost_excl END;
      n_com := n_com + 1;
    END LOOP;
  END LOOP;

  -- jobs completed -> units installed (allocated stock is drawn down by the trigger)
  UPDATE public.cf_commitments c SET status = 'installed'
    FROM public.jobs j WHERE c.company_id = p_company AND c.job_id = j.id AND j.status = 'completed' AND c.status <> 'installed';

  PERFORM set_config('cf.sync', '', true);
  RETURN jsonb_build_object('receipts', n_rec, 'commitments', n_com);
END $function$
;

CREATE OR REPLACE FUNCTION public.publish_inhouse_book(p_supplier_id uuid, p_file_name text, p_pdf_url text, p_storage_path text, p_pages jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_upload uuid; v_item jsonb; v_pid uuid; v_sku uuid; v_cost numeric; v_len numeric; v_metre boolean;
  v_code text; v_missing int; v_ids uuid[] := '{}';
BEGIN
  IF NOT can_write_master_catalog(auth.uid()) THEN
    RAISE EXCEPTION 'Only master-catalogue admins can change in-house items' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND supplier_type = 'consumables') THEN
    RAISE EXCEPTION 'In-house items can only be added to a consumables supplier (One Stop Shop)';
  END IF;
  IF jsonb_typeof(p_pages) <> 'array' OR jsonb_array_length(p_pages) = 0 THEN RAISE EXCEPTION 'No pages'; END IF;
  SELECT array_agg((x->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_items) x WHERE nullif(x->>'id','') IS NOT NULL;
  SELECT count(*) INTO v_missing FROM supplier_products sp
   WHERE sp.supplier_id = p_supplier_id AND sp.import_flags @> ARRAY['in_house'] AND NOT coalesce(sp.archived,false)
     AND NOT (sp.id = ANY (coalesce(v_ids, '{}')));
  IF v_missing > 0 THEN RAISE EXCEPTION 'Stale item list (% live in-house items missing) - reload and try again', v_missing; END IF;
  INSERT INTO pdf_uploads (supplier_id, file_name, file_path, storage_path, file_url, status, page_count, price_list_type,
                           brand, is_active, markup_percent, price_includes_vat)
  VALUES (p_supplier_id, p_file_name, p_storage_path, p_storage_path, p_pdf_url, 'parsed', jsonb_array_length(p_pages),
          'in_house', 'In-house', false, 100, false)
  RETURNING id INTO v_upload;
  INSERT INTO supplier_pdf_pages (supplier_id, pdf_filename, page_number, page_image_url, pdf_storage_path, price_column_bbox, brand, pdf_upload_id)
  SELECT p_supplier_id::text, p_file_name, (pg->>'page_number')::int, pg->>'page_image_url', p_pdf_url,
         pg->'price_column_bbox', 'In-house', v_upload
    FROM jsonb_array_elements(p_pages) pg;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := nullif(v_item->>'id','')::uuid;
    IF coalesce((v_item->>'archived')::boolean, false) THEN
      IF v_pid IS NULL THEN CONTINUE; END IF;
      UPDATE supplier_products SET archived = true, is_active = false, archived_at = coalesce(archived_at, now()), updated_at = now()
       WHERE id = v_pid AND supplier_id = p_supplier_id AND import_flags @> ARRAY['in_house'];
      UPDATE supplier_sku_map SET active_to = current_date WHERE supplier_product_id = v_pid AND active_to IS NULL;
      CONTINUE;
    END IF;
    v_code := v_item->>'sku_code';
    v_cost := round((v_item->>'cost')::numeric, 2);
    v_metre := coalesce((v_item->>'per_metre')::boolean, false);
    v_len := nullif(v_item->>'unit_length','')::numeric;
    IF v_code IS NULL OR v_code !~ '^[A-Z0-9]+(-[A-Z0-9._]+)*$' THEN RAISE EXCEPTION 'Bad SKU %', v_code; END IF;
    IF v_cost IS NULL OR v_cost <= 0 THEN RAISE EXCEPTION 'Cost must be above 0 for %', v_code; END IF;
    IF v_metre AND (v_len IS NULL OR v_len <= 0) THEN RAISE EXCEPTION 'Coil length needed for per-metre item %', v_code; END IF;
    INSERT INTO internal_skus (sku_code, family, type_code, size_code, variant, name, category, unit)
    VALUES (v_code, v_item->>'family', v_item->>'type_code', v_item->>'size_code', nullif(v_item->>'variant',''),
            v_item->>'name', v_item->>'category', CASE WHEN v_metre THEN 'metre' ELSE 'each' END)
    ON CONFLICT (sku_code) DO UPDATE SET name = excluded.name, category = excluded.category, unit = excluded.unit,
      family = excluded.family, type_code = excluded.type_code, size_code = excluded.size_code, variant = excluded.variant,
      is_active = true, updated_at = now()
    RETURNING id INTO v_sku;
    IF v_pid IS NULL THEN
      INSERT INTO supplier_products (supplier_id, product_code, description, import_flags, pdf_upload_id, archived, is_active)
      VALUES (p_supplier_id, v_code, coalesce(nullif(v_item->>'description',''), v_item->>'name', v_code), ARRAY['in_house'], v_upload, true, false)
      RETURNING id INTO v_pid;
    END IF;
    UPDATE supplier_products SET
      product_code = v_code, name = v_item->>'name', short_name = v_item->>'name', description = coalesce(nullif(v_item->>'description',''), v_item->>'name'),
      category = v_item->>'category', subcategory = 'In-house', product_category = 'Consumables', brand = 'One Stop Shop',
      product_type = 'consumable', pricing_mode = 'per-unit', vat_rate = 15, price_includes_vat = false,
      cost_price = v_cost, cost_excl_vat = v_cost, list_price_raw = v_cost, original_cost_excl_vat = v_cost,
      cost_incl_vat = round(v_cost * 1.15, 2), supplier_discount_percent = 0,
      default_markup_percent = 100, markup_percent = 100, -- selling_price is generated (cost x (1+markup))
      sold_in_length = v_metre, unit_length = CASE WHEN v_metre THEN v_len END, unit_length_unit = 'm',
      price_per_metre = CASE WHEN v_metre THEN round(v_cost / v_len, 2) END, min_cut_length = 0.5,
      price_per_unit_qty = 1, price_per_unit_label = CASE WHEN v_metre THEN 'm' ELSE 'each' END,
      allows_decimal_qty = v_metre, qty_step = CASE WHEN v_metre THEN 0.1 ELSE 1 END, min_qty = CASE WHEN v_metre THEN 0 ELSE 1 END,
      import_flags = ARRAY['in_house'], import_confidence = 'in_house',
      pdf_upload_id = v_upload, page_number = (v_item->>'page_number')::int, row_bbox = v_item->'row_bbox', price_bbox = v_item->'price_bbox',
      archived = false, archived_at = NULL, is_active = true, updated_at = now()
    WHERE id = v_pid AND supplier_id = p_supplier_id AND import_flags @> ARRAY['in_house'];
    IF NOT FOUND THEN RAISE EXCEPTION 'Item % is not an in-house item of this supplier', v_pid; END IF;
    UPDATE supplier_sku_map SET active_to = current_date WHERE supplier_product_id = v_pid AND active_to IS NULL AND sku_id <> v_sku;
    INSERT INTO supplier_sku_map (sku_id, supplier_id, supplier_code, supplier_product_id, source)
    SELECT v_sku, p_supplier_id, NULL, v_pid, 'in_house'
     WHERE NOT EXISTS (SELECT 1 FROM supplier_sku_map WHERE supplier_product_id = v_pid AND active_to IS NULL);
  END LOOP;
  UPDATE pdf_uploads SET is_active = false, status = 'archived', updated_at = now()
   WHERE supplier_id = p_supplier_id AND price_list_type = 'in_house' AND id <> v_upload AND is_active;
  UPDATE pdf_uploads SET is_active = true, activated_at = now(), updated_at = now() WHERE id = v_upload;
  RETURN v_upload;
END $function$
;

-- in-house / live consumables were written as 'ac_unit'; 'consumable' is the value the importer (diffImportPipeline) and the Consumables catalogue table use
UPDATE public.supplier_products SET product_type = 'consumable' WHERE product_type = 'ac_unit' AND product_category = 'Consumables' AND id IN ('01b021f9-d99d-4e3f-9de1-6c212a0029d6','02e42314-017f-4b56-b9b1-d8621898d8e5','052f80a5-b523-41db-9855-4f3e0d14b293','11042806-e635-4bd9-b575-109579dca690','1c91b82f-f9ae-4a9d-bcee-1aecfaad8034','22b9dd66-2fbe-4eb0-8dda-0180b5b499b4','245e1377-15c8-4308-8adc-6d81811e1f4b','378f60ce-22fe-4683-88eb-eb2cb1d3473b','3df19154-83d4-4429-a591-5c3b08bb118d','3f7ede24-1b8c-42ed-9925-46269c665a70','45d8dd63-4a44-42a6-878a-bb475e5bbe32','4af26675-b259-491f-adb2-6cc1b01a0fa8','4e7a12a0-1f24-4fd9-9e42-08a0ecb04a62','4eb9d807-7485-4ff9-873c-620dfb2f4b9c','55063767-db47-4350-8dae-eb36e27455b5','582f17df-3727-413b-820d-5b9d383d7e38','5d927f58-6f7f-4809-b81d-601876bef5e0','5f546317-db55-43cc-a7eb-3cc4da941e69','613bed49-75db-49bb-a9af-4e65e1ce1ee6','628a8e9a-07ee-4293-a7a8-5aea424f5668','6316611a-840d-4dd9-8c24-6915c1e9aaf0','6686ee2f-8cdf-4875-9185-5b0df36b685b','68b89805-7019-4587-ba0a-d4a7fe6933ac','761f1c00-e4ea-4e1f-9b24-2882aa12c897','766a46c8-0636-494a-b408-f41117ed9d00','7ee47ef1-1b5b-4085-b906-69d4010d01cf','7ef781a3-423c-4ab1-a612-3844b562c189','827b6787-7c41-4aa6-8280-d08e65c2639a','84e8e8a4-31fe-4659-a540-750d976231a5','880cba2d-aae9-4383-ad39-e25b8f95c57b','8837a7f4-2201-499c-afd8-87ef96fbd3fa','92956e51-25ac-4cd0-a3ce-8e0cb57058e0','9a6d6b42-2551-4779-99e1-f2f100dae609','a1752aab-5435-4e7f-bf48-d2265ab903be','a29abd0e-f4e5-4344-a699-9afa9f3d6085','a303c80c-e9d6-4e9a-9029-e08c8b74999c','a323ca06-0335-4b26-a8fe-39419c980189','aea72284-45eb-4b09-8288-cb5da8393691','b21b15b7-f930-47f9-a010-2efa3790679e','b56eb6f0-0254-4de2-a9eb-60737accf251','bb8d8c04-2748-45b5-acc6-2b178f2828aa','bd8cdcf2-769f-481a-8238-ed9d5b20fbeb','bda752b7-079d-499a-87f4-4edaa5734f1b','bfa739db-9824-4ed9-a13d-a3a748b6b21e','c1eb9ab3-eead-4d4c-8402-d774dbf10e8c','c2545f2a-1314-4cc3-95ed-52a6d7209cb7','c355bbd3-c78a-4572-8e2c-f84ac774f146','c4ff7d25-ec5f-4225-8b7d-bfdda1ff1159','c630f583-7444-4a7f-8ab5-050e25d8f029','c7549d0e-8580-42bb-9462-e24b259e1606','c983ba89-8bc9-42ed-8ab2-4b66269ab9dd','c9f0c931-440a-4a41-b36a-8d225dbdcd28','c9fc1575-1bf8-4584-8bfd-7f3977ba22dd','ca40a14b-17d9-44ed-8d5e-053d3d1517c0','cb0ddac6-c7a2-40c5-a4cf-f50a48b9c5df','cb370e09-5930-431e-8748-ccd41d749d78','cc034389-2b43-4cd6-96cd-3ce64fe48a5c','d130de67-4810-4efa-9b2b-d20fee9c1729','d198e8f5-dc71-4fef-af45-13304b4029f2','d7d937a0-aec7-4466-aeaa-66329a7b23ff','d972412d-e605-4a34-9787-f4bbc2f91e55','da850a98-b208-4608-ae19-e585ebaed9d6','dc7f6bcb-fc9c-4c80-b383-0b70f3df481a','dede57ec-017e-4f29-b1c7-a49600d7c14d','ed8a1604-099c-4027-8773-3773a5df2c48','f4372728-cf97-4006-aa7e-21ab62e288db','f65bf76d-340e-4fa1-823d-d42058ad4558','f9cfdd97-38f9-461a-9344-bc4710860188','fd1a1be3-ee7f-4bb0-bd26-12c1da071ae7');
