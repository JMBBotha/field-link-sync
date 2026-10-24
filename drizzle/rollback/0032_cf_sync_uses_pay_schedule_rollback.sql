-- Rollback 0032: restore _cf_sync_core as it was before (live definition 2026-10-24).
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
END $function$;
