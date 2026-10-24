-- 0034: Cape Estates decision (Johan 24 Oct 09:10): invoices are the single source of payment dates.
-- Adds invoices.final_unscheduled (default false = no change for anyone else). When true and no final date is set,
-- the final payment has NO date ("Unscheduled"): _inv_pay_schedule returns final_date NULL / status 'unscheduled',
-- the Cash Health sync stores expected_date NULL, and the forecast keeps it out of the dated weeks (separate total).
-- Setting a final date on the invoice clears the flag. No amounts, statuses or emails touched.
-- Rollback: drizzle/rollback/0034_final_unscheduled_rollback.sql
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS final_unscheduled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._inv_pay_schedule(p_invoice uuid)
 RETURNS TABLE (invoice_id uuid, has_deposit boolean,
   deposit_amount numeric, deposit_date date, deposit_date_auto boolean, deposit_paid numeric, deposit_outstanding numeric, deposit_status text,
   final_amount numeric, final_date date, final_date_auto boolean, final_after_days int, final_paid numeric, final_outstanding numeric, final_status text,
   terms_days int)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE i public.invoices; t record; v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_paid numeric; v_cred numeric := 0; v_dep numeric; v_fin numeric; v_base date; v_ddate date; v_fdays int; v_fdate date; v_cust_days int;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice; IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO t FROM public._inv_terms(p_invoice);
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE payments.invoice_id = p_invoice AND status IN ('paid','succeeded','completed');
  SELECT COALESCE(SUM(total),0) INTO v_cred FROM public.credit_notes cn WHERE cn.invoice_id = p_invoice AND COALESCE(cn.status,'') <> 'void';
  SELECT c.final_after_days INTO v_cust_days FROM public.customers c WHERE c.id = i.customer_id;
  v_dep := CASE WHEN COALESCE(i.deposit_amount,0) > 0 THEN round(i.deposit_amount,2) ELSE 0 END;
  v_fin := GREATEST(0, round(COALESCE(i.grand_total,0) - v_dep - v_cred, 2));
  v_base := COALESCE(i.issue_date, (i.created_at at time zone 'Africa/Johannesburg')::date) + COALESCE(t.days, 30);
  v_ddate := COALESCE(i.expected_deposit_date, v_base);
  v_fdays := COALESCE(i.final_after_days, v_cust_days, 30);
  v_fdate := COALESCE(i.expected_final_date, CASE WHEN v_dep > 0 AND i.final_unscheduled THEN NULL WHEN v_dep > 0 THEN v_ddate + v_fdays ELSE v_ddate END);
  invoice_id := i.id; has_deposit := v_dep > 0; terms_days := COALESCE(t.days, 30);
  deposit_amount := v_dep; deposit_date := CASE WHEN v_dep > 0 THEN v_ddate END; deposit_date_auto := i.expected_deposit_date IS NULL;
  deposit_paid := LEAST(v_paid, v_dep); deposit_outstanding := v_dep - LEAST(v_paid, v_dep);
  final_amount := v_fin; final_date := v_fdate; final_date_auto := i.expected_final_date IS NULL AND v_fdate IS NOT NULL; final_after_days := v_fdays;
  final_paid := LEAST(GREATEST(v_paid - v_dep, 0), v_fin); final_outstanding := v_fin - LEAST(GREATEST(v_paid - v_dep, 0), v_fin);
  deposit_status := CASE WHEN v_dep = 0 THEN 'none' WHEN deposit_outstanding <= 0.005 THEN 'paid'
    WHEN lower(COALESCE(i.status,'')) IN ('void','cancelled') THEN 'void' WHEN v_ddate < v_today THEN 'overdue'
    WHEN deposit_paid > 0 THEN 'part_paid' ELSE 'outstanding' END;
  final_status := CASE WHEN lower(COALESCE(i.status,'')) IN ('void','cancelled') THEN 'void' WHEN final_outstanding <= 0.005 THEN 'paid'
    WHEN v_fdate IS NULL THEN 'unscheduled' WHEN v_fdate < v_today THEN 'overdue' WHEN final_paid > 0 THEN 'part_paid' ELSE 'outstanding' END;
  IF lower(COALESCE(i.status,'')) IN ('void','cancelled') AND v_dep > 0 AND deposit_status <> 'paid' THEN deposit_status := 'void'; END IF;
  -- Draft = not sent yet: never "overdue", shown as not sent (still counts as expected money in the forecast).
  IF lower(COALESCE(i.status,'')) = 'draft' THEN
    IF deposit_status IN ('overdue','outstanding') THEN deposit_status := 'not_sent'; END IF;
    IF final_status IN ('overdue','outstanding') THEN final_status := 'not_sent'; END IF;
  END IF;
  RETURN NEXT;
END $function$;
REVOKE ALL ON FUNCTION public._inv_pay_schedule(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_invoice_payment_dates(p_invoice uuid, p_deposit_date date, p_final_after_days int, p_final_date date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.invoices WHERE id = p_invoice;
  IF v_co IS NULL OR v_co IS DISTINCT FROM public.get_user_company_id(auth.uid()) OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the owner or an admin can change payment dates' USING ERRCODE = '42501'; END IF;
  IF p_final_after_days IS NOT NULL AND (p_final_after_days < 0 OR p_final_after_days > 365) THEN RAISE EXCEPTION 'Days must be 0 to 365'; END IF;
  IF p_deposit_date IS NOT NULL AND p_final_date IS NOT NULL AND p_final_date < p_deposit_date THEN
    RAISE EXCEPTION 'Final payment date cannot be before the deposit date'; END IF;
  UPDATE public.invoices SET expected_deposit_date = p_deposit_date, final_after_days = p_final_after_days, expected_final_date = p_final_date,
     final_unscheduled = CASE WHEN p_final_date IS NOT NULL THEN false ELSE final_unscheduled END
   WHERE id = p_invoice;
END $function$;
GRANT EXECUTE ON FUNCTION public.set_invoice_payment_dates(uuid, date, int, date) TO authenticated;

-- Owner/admin: mark the final payment as unscheduled (true) or back to automatic/dated (false).
CREATE OR REPLACE FUNCTION public.set_invoice_final_unscheduled(p_invoice uuid, p_on boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.invoices WHERE id = p_invoice;
  IF v_co IS NULL OR v_co IS DISTINCT FROM public.get_user_company_id(auth.uid()) OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the owner or an admin can change payment dates' USING ERRCODE = '42501'; END IF;
  UPDATE public.invoices SET final_unscheduled = coalesce(p_on, false), expected_final_date = CASE WHEN p_on THEN NULL ELSE expected_final_date END WHERE id = p_invoice;
END $function$;
GRANT EXECUTE ON FUNCTION public.set_invoice_final_unscheduled(uuid, boolean) TO authenticated;

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
  n_rec int := 0; ps record; n_com int := 0; v_vat numeric; v_dep_pct numeric; v_label text;
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
    -- 0032: amounts + dates come from the invoice payment schedule (same as the invoice's Expected payments card)
    SELECT * INTO ps FROM public._inv_pay_schedule(inv.id);
    v_parts := CASE WHEN NOT ps.has_deposit THEN jsonb_build_array(jsonb_build_object('part','full','amt',ps.final_amount,'d',ps.final_date,'e',NOT ps.final_date_auto))
      WHEN ps.final_amount > 0.005 THEN jsonb_build_array(jsonb_build_object('part','deposit','amt',ps.deposit_amount,'d',ps.deposit_date,'e',NOT ps.deposit_date_auto), jsonb_build_object('part','final','amt',ps.final_amount,'d',ps.final_date,'e',NOT ps.final_date_auto OR ps.final_date IS NULL))
      ELSE jsonb_build_array(jsonb_build_object('part','deposit','amt',ps.deposit_amount,'d',ps.deposit_date,'e',NOT ps.deposit_date_auto)) END;
    -- drop untouched expected rows for parts this invoice no longer has
    DELETE FROM public.cf_receipts r WHERE r.company_id = p_company AND r.invoice_id = inv.id AND r.source = 'field_lynk' AND r.status = 'expected'
      AND r.source_key LIKE 'inv:%' AND NOT (r.part IN (SELECT x->>'part' FROM jsonb_array_elements(v_parts) x));
    v_left := inv.paid_sum;
    v_base := CASE WHEN inv.status = 'draft' THEN current_date + 7 ELSE coalesce(inv.due_date, inv.issue_date + 7, current_date + 7) END;
    v_dep_date := NULL;

    FOR pt IN SELECT * FROM jsonb_array_elements(v_parts) LOOP
      v_part := pt->>'part'; v_amt := (pt->>'amt')::numeric;
      v_rec := v_left >= v_amt - 0.01; v_left := greatest(0, v_left - v_amt);
      v_exp := (pt->>'d')::date;
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
        expected_date = CASE WHEN r.dates_edited AND NOT coalesce((pt->>'e')::boolean, false) THEN r.expected_date ELSE excluded.expected_date END,
        dates_edited = CASE WHEN coalesce((pt->>'e')::boolean, false) THEN false ELSE r.dates_edited END,
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
