-- Johan 13 Oct 2026: costed 'service' lines (cost > 0) count towards sales commission; uncosted service + labour lines stay excluded.
-- Rollback: /workspace/quote-profit-2026-10-13/_earnings_for_quote.prev.sql
CREATE OR REPLACE FUNCTION public._earnings_for_quote(p_quote_id uuid, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  q record; v_co uuid; v_owner boolean; v_is_rep boolean; v_is_tech boolean;
  v_gross numeric := 0; v_disc numeric := 0;
  v_items_sell numeric := 0; v_items_cost numeric := 0; v_profit numeric := 0;
  v_unknown int := 0; v_services int := 0;
  v_lab_sell numeric := 0; v_lab_gross numeric := 0; v_hours numeric := 0; v_rate numeric;
  v_inv_count int := 0; v_all_paid boolean := false; v_paid_at date;
  v_paid boolean; v_srule jsonb; v_trule jsonb; v_spct numeric; v_tpct numeric := 0;
  v_commission numeric; v_split text; v_n int; v_techs uuid[];
  v_slice numeric; v_parts jsonb; v_tech_list jsonb := '[]'::jsonb; v_me jsonb; v_t uuid;
  v_res jsonb;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND OR p_viewer IS NULL THEN RETURN NULL; END IF;
  v_co := COALESCE(q.company_id, (SELECT id FROM public.companies WHERE is_master ORDER BY created_at LIMIT 1));
  v_owner := public.is_company_owner(p_viewer, v_co);
  v_is_rep := q.sales_engineer_id IS NOT DISTINCT FROM p_viewer AND q.sales_engineer_id IS NOT NULL;
  SELECT array_agg(DISTINCT a.profile_id ORDER BY a.profile_id) INTO v_techs
    FROM public.jobs j JOIN public.assignments a ON a.job_id = j.id
   WHERE j.quote_id = q.id AND a.profile_id IS NOT NULL
     AND COALESCE(a.status,'') NOT IN ('declined','rejected','cancelled');
  v_n := COALESCE(array_length(v_techs,1),0);
  v_is_tech := p_viewer = ANY(COALESCE(v_techs,'{}'));
  IF NOT (v_owner OR v_is_rep OR v_is_tech) THEN RETURN NULL; END IF;

  WITH li AS (
    SELECT round(COALESCE(i.quantity,0)::numeric * COALESCE(i.unit_price,0)::numeric, 2) AS sell,
           COALESCE(i.quantity,0)::numeric AS qty,
           (i.item_type = 'labour' AND i.metadata->'labour' IS NOT NULL
              AND i.metadata->'labour' NOT IN ('false'::jsonb,'null'::jsonb,'0'::jsonb,'""'::jsonb)) AS is_labour,
           (lower(COALESCE(i.item_type,'')) = 'service' OR (i.metadata->'catalog_service_id' IS NOT NULL
              AND i.metadata->'catalog_service_id' NOT IN ('false'::jsonb,'null'::jsonb,'0'::jsonb,'""'::jsonb))) AS is_service,
           COALESCE(i.metadata->>'unit_cost', i.metadata->>'cost', i.metadata->>'cost_price') AS raw_cost,
           COALESCE(i.metadata->>'hours', i.quantity::text) AS raw_hours
      FROM public.quote_items i WHERE i.quote_id = q.id AND i.parent_item_id IS NULL
  ), l AS (
    SELECT li.*, CASE WHEN raw_cost ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND raw_cost::numeric > 0 THEN raw_cost::numeric END AS unit_cost,
           CASE WHEN raw_hours ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN raw_hours::numeric ELSE 0 END AS hours
      FROM li
  )
  SELECT COALESCE(sum(sell),0),
         count(*) FILTER (WHERE NOT is_labour AND unit_cost IS NULL),
         count(*) FILTER (WHERE is_service AND unit_cost IS NULL),
         COALESCE(sum(sell) FILTER (WHERE is_labour),0),
         COALESCE(sum(hours) FILTER (WHERE is_labour),0)
    INTO v_gross, v_unknown, v_services, v_lab_gross, v_hours FROM l;
  v_disc := greatest(0, CASE WHEN q.discount_type IN ('percentage','percent') THEN v_gross * COALESCE(q.discount_value,0) / 100
                             WHEN q.discount_type = 'fixed' THEN COALESCE(q.discount_value,0) ELSE 0 END);
  WITH li AS (
    SELECT round(COALESCE(i.quantity,0)::numeric * COALESCE(i.unit_price,0)::numeric, 2) AS sell,
           COALESCE(i.quantity,0)::numeric AS qty,
           (i.item_type = 'labour' AND i.metadata->'labour' IS NOT NULL
              AND i.metadata->'labour' NOT IN ('false'::jsonb,'null'::jsonb,'0'::jsonb,'""'::jsonb)) AS is_labour,
           (lower(COALESCE(i.item_type,'')) = 'service' OR (i.metadata->'catalog_service_id' IS NOT NULL
              AND i.metadata->'catalog_service_id' NOT IN ('false'::jsonb,'null'::jsonb,'0'::jsonb,'""'::jsonb))) AS is_service,
           COALESCE(i.metadata->>'unit_cost', i.metadata->>'cost', i.metadata->>'cost_price') AS raw_cost
      FROM public.quote_items i WHERE i.quote_id = q.id AND i.parent_item_id IS NULL
  ), l AS (
    SELECT li.*, CASE WHEN raw_cost ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' AND raw_cost::numeric > 0 THEN raw_cost::numeric END AS unit_cost,
           CASE WHEN v_gross > 0 THEN v_disc * sell / v_gross ELSE 0 END AS dshare
      FROM li
  )
  SELECT round(COALESCE(sum(sell - dshare) FILTER (WHERE NOT is_labour AND unit_cost IS NOT NULL),0),2),
         round(COALESCE(sum(round(qty * unit_cost,2)) FILTER (WHERE NOT is_labour AND unit_cost IS NOT NULL),0),2),
         round(COALESCE(sum(sell - dshare) FILTER (WHERE is_labour),0),2)
    INTO v_items_sell, v_items_cost, v_lab_sell FROM l;
  v_profit := round(v_items_sell - v_items_cost, 2);
  v_rate := CASE WHEN v_hours > 0 THEN round(v_lab_gross / v_hours, 2) END;

  SELECT count(*),
         COALESCE(bool_and(i.status = 'paid' OR COALESCE((SELECT sum(p.amount) FROM public.payments p
                    WHERE p.invoice_id = i.id AND p.status = 'paid'),0) >= COALESCE(i.grand_total,0)), false),
         max(i.paid_date)
    INTO v_inv_count, v_all_paid, v_paid_at
    FROM public.invoices i
   WHERE (i.quote_id = q.id OR i.id IN (SELECT j.invoice_id FROM public.jobs j WHERE j.quote_id = q.id AND j.invoice_id IS NOT NULL))
     AND COALESCE(i.status,'') NOT IN ('void','voided','cancelled');
  v_paid := v_inv_count > 0 AND v_all_paid AND COALESCE((SELECT sum(CASE WHEN i.status = 'paid' THEN COALESCE(i.grand_total,0)
           ELSE COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id AND p.status = 'paid'),0) END)
      FROM public.invoices i
     WHERE (i.quote_id = q.id OR i.id IN (SELECT j.invoice_id FROM public.jobs j WHERE j.quote_id = q.id AND j.invoice_id IS NOT NULL))
       AND COALESCE(i.status,'') NOT IN ('void','voided','cancelled')),0) >= COALESCE(q.total,0) - 0.01;

  v_srule := public.earnings_sales_rule(v_co);
  v_spct := (v_srule->>'percent')::numeric;
  v_commission := round(greatest(0, v_profit) * v_spct / 100, 2);
  v_trule := public.earnings_tech_rule(v_co);
  SELECT COALESCE(sum((p->>'percent')::numeric),0) INTO v_tpct FROM jsonb_array_elements(v_trule->'parts') p;
  v_split := COALESCE((SELECT tech_split_mode FROM public.companies WHERE id = v_co), 'even');
  v_slice := CASE WHEN v_n > 0 THEN v_lab_sell / v_n ELSE v_lab_sell END;

  IF v_n > 0 THEN
    FOREACH v_t IN ARRAY v_techs LOOP
      SELECT jsonb_agg(p || jsonb_build_object('amount', round(v_slice * (p->>'percent')::numeric / 100, 2)))
        INTO v_parts FROM jsonb_array_elements(v_trule->'parts') p;
      v_me := jsonb_build_object('profile_id', v_t, 'is_me', v_t = p_viewer,
        'hours', round(v_hours / v_n, 2), 'labour_rate', v_rate, 'percent', v_tpct,
        'amount', round(v_slice * v_tpct / 100, 2), 'parts', COALESCE(v_parts,'[]'::jsonb),
        'status', CASE WHEN v_paid THEN 'earned' ELSE 'pending' END);
      v_tech_list := v_tech_list || jsonb_build_array(v_me);
    END LOOP;
  END IF;

  v_res := jsonb_build_object('quote_id', q.id, 'quote_number', q.quote_number, 'quote_status', q.status,
    'viewer', jsonb_build_object('is_owner', v_owner, 'is_rep', v_is_rep, 'is_tech', v_is_tech),
    'paid_in_full', v_paid, 'paid_at', v_paid_at);

  IF v_owner OR v_is_rep THEN
    v_res := v_res || jsonb_build_object('sales', jsonb_build_object(
      'rep_id', q.sales_engineer_id, 'is_me', v_is_rep, 'rule', v_srule, 'percent', v_spct,
      'items_sell_ex_vat', v_items_sell, 'items_cost', v_items_cost, 'items_profit', v_profit,
      'commission', v_commission, 'status', CASE WHEN q.sales_engineer_id IS NULL THEN 'no_rep' WHEN v_paid THEN 'earned' ELSE 'pending' END,
      'unknown_cost_count', v_unknown, 'excluded_service_count', v_services,
      'gp_target_percent', COALESCE((SELECT gp_target_percent FROM public.companies WHERE id = v_co), 20)));
  END IF;

  IF v_owner THEN
    v_res := v_res || jsonb_build_object('tech', jsonb_build_object(
      'rule', v_trule, 'percent', v_tpct, 'split_mode', v_split, 'split_mode_applied', 'even',
      'labour_sell_ex_vat', v_lab_sell, 'hours', v_hours, 'labour_rate', v_rate,
      'techs', v_tech_list, 'pool', round(v_lab_sell * v_tpct / 100, 2)),
      'company', jsonb_build_object(
      'items_keep', round(v_profit - v_commission, 2),
      'labour_keep', round(v_lab_sell - v_lab_sell * v_tpct / 100, 2),
      'discount', round(v_disc, 2),
      'tools_percent', COALESCE((v_trule->>'tools_percent')::numeric, 0),
      'tools_keep', round(v_lab_sell * COALESCE((v_trule->>'tools_percent')::numeric, 0) / 100, 2)));
  ELSIF v_is_tech THEN
    v_res := v_res || jsonb_build_object('tech', jsonb_build_object(
      'rule_version', v_trule->>'version', 'split_mode_applied', 'even', 'tech_count', v_n,
      'me', (SELECT e FROM jsonb_array_elements(v_tech_list) e WHERE (e->>'is_me')::boolean LIMIT 1) - 'is_me' - 'profile_id'));
  END IF;
  RETURN v_res;
END $function$
;

-- One company-scoped list of per-quote profit for the Quotes list. Admin/owner: all figures. Rep: own quotes, commission only. Techs/others: nothing.
CREATE OR REPLACE FUNCTION public.get_company_quote_profit(p_company_id uuid)
 RETURNS TABLE(quote_id uuid, sell_ex_vat numeric, cost numeric, lines_total int, lines_costed int,
               commission numeric, company_profit numeric, rep_id uuid, full_view boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_admin boolean; v_viewer uuid; r record; e jsonb; v_lc numeric;
BEGIN
  IF v_uid IS NULL OR p_company_id IS NULL THEN RETURN; END IF;
  v_admin := public.is_company_admin(v_uid, p_company_id)
    OR (public.has_role(v_uid, 'admin'::app_role) AND p_company_id = public.caller_company_id());
  IF v_admin THEN
    v_viewer := COALESCE((SELECT cm.user_id FROM public.company_members cm WHERE cm.company_id = p_company_id AND cm.role = 'admin' AND cm.is_owner ORDER BY cm.created_at LIMIT 1), v_uid);
  ELSE
    v_viewer := v_uid;
  END IF;
  SELECT c.labour_cost_per_hour INTO v_lc FROM public.companies c WHERE c.id = p_company_id;
  FOR r IN SELECT qt.id, qt.sales_engineer_id FROM public.quotes qt
            WHERE qt.company_id = p_company_id AND (v_admin OR qt.sales_engineer_id = v_uid)
            ORDER BY qt.created_at DESC LIMIT 1000 LOOP
    e := public._apply_commission_snapshot(public._earnings_for_quote(r.id, v_viewer));
    IF e IS NULL OR NOT (e ? 'sales') THEN CONTINUE; END IF;
    quote_id := r.id; rep_id := r.sales_engineer_id; full_view := v_admin;
    commission := (e->'sales'->>'commission')::numeric;
    SELECT count(*)::int,
           count(*) FILTER (WHERE (i.item_type = 'labour' AND i.metadata->'labour' IS NOT NULL AND i.metadata->'labour' NOT IN ('false'::jsonb,'null'::jsonb,'0'::jsonb,'""'::jsonb))
              OR CASE WHEN COALESCE(i.metadata->>'unit_cost', i.metadata->>'cost', i.metadata->>'cost_price') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                      THEN COALESCE(i.metadata->>'unit_cost', i.metadata->>'cost', i.metadata->>'cost_price')::numeric > 0 ELSE false END)::int,
           round(COALESCE(sum(COALESCE(i.quantity,0)::numeric * COALESCE(i.unit_price,0)::numeric),0) - COALESCE((e->'company'->>'discount')::numeric,0), 2)
      INTO lines_total, lines_costed, sell_ex_vat
      FROM public.quote_items i WHERE i.quote_id = r.id AND i.parent_item_id IS NULL;
    IF v_admin THEN
      cost := round(COALESCE((e->'sales'->>'items_cost')::numeric,0) + COALESCE((e->'tech'->>'pool')::numeric,0), 2);
      company_profit := round(COALESCE((e->'company'->>'items_keep')::numeric,0) + COALESCE((e->'company'->>'labour_keep')::numeric,0), 2);
    ELSE
      cost := NULL; company_profit := NULL; sell_ex_vat := NULL;
    END IF;
    RETURN NEXT;
  END LOOP;
END $function$;
REVOKE ALL ON FUNCTION public.get_company_quote_profit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_quote_profit(uuid) TO authenticated;
