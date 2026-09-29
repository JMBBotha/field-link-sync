ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS tech_split_mode text NOT NULL DEFAULT 'even';

CREATE OR REPLACE FUNCTION public.is_company_owner(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members
    WHERE user_id = _user_id AND company_id = _company_id AND role = 'admin' AND is_owner);
$$;

CREATE OR REPLACE FUNCTION public.guard_company_owner_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_owner AND NOT public.is_company_owner(auth.uid(), NEW.company_id) THEN
      RAISE EXCEPTION 'Only the company owner can grant the owner flag';
    END IF;
  ELSIF (NEW.is_owner IS DISTINCT FROM OLD.is_owner OR (OLD.is_owner AND NEW.company_id IS DISTINCT FROM OLD.company_id))
        AND NOT public.is_company_owner(auth.uid(), OLD.company_id) THEN
    RAISE EXCEPTION 'Only the company owner can change the owner flag';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_company_owner_flag ON public.company_members;
CREATE TRIGGER trg_guard_company_owner_flag BEFORE INSERT OR UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_owner_flag();

UPDATE public.company_members SET is_owner = true
 WHERE user_id = '420c7731-e8a4-4355-80ca-51c684b42a2c'
   AND company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' AND role = 'admin';

CREATE OR REPLACE FUNCTION public.earnings_sales_rule(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('version','sales_v1_items_profit','basis','physical_items_profit_ex_vat',
    'percent', COALESCE((SELECT sales_commission_percent FROM public.companies WHERE id = p_company_id), 50),
    'labour_percent', 0, 'earned_when','invoice_paid_in_full');
$$;

CREATE OR REPLACE FUNCTION public.earnings_tech_rule(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('version','tech_v1_labour_share','basis','labour_sell_ex_vat',
    'parts', jsonb_build_array(jsonb_build_object('kind','paid','percent',
      COALESCE((SELECT labour_tech_share_percent FROM public.companies WHERE id = p_company_id), 60),'hold_days',0)));
$$;

CREATE OR REPLACE FUNCTION public._earnings_for_quote(p_quote_id uuid, p_viewer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
         count(*) FILTER (WHERE is_service),
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
  SELECT round(COALESCE(sum(sell - dshare) FILTER (WHERE NOT is_labour AND NOT is_service AND unit_cost IS NOT NULL),0),2),
         round(COALESCE(sum(round(qty * unit_cost,2)) FILTER (WHERE NOT is_labour AND NOT is_service AND unit_cost IS NOT NULL),0),2),
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
  v_paid := v_inv_count > 0 AND v_all_paid;

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
      'discount', round(v_disc, 2)));
  ELSIF v_is_tech THEN
    v_res := v_res || jsonb_build_object('tech', jsonb_build_object(
      'rule_version', v_trule->>'version', 'split_mode_applied', 'even', 'tech_count', v_n,
      'me', (SELECT e FROM jsonb_array_elements(v_tech_list) e WHERE (e->>'is_me')::boolean LIMIT 1) - 'is_me' - 'profile_id'));
  END IF;
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_earnings(p_quote_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_list jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  IF p_quote_id IS NOT NULL THEN
    v_list := public._earnings_for_quote(p_quote_id, v_uid);
    RETURN jsonb_build_object('api_version', 1, 'user_id', v_uid,
      'quotes', CASE WHEN v_list IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_list) END);
  END IF;
  SELECT COALESCE(jsonb_agg(e ORDER BY created_at DESC), '[]'::jsonb) INTO v_list FROM (
    SELECT public._earnings_for_quote(qt.id, v_uid) e, qt.created_at
      FROM public.quotes qt
     WHERE (qt.status = 'accepted' OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = qt.id))
     ORDER BY qt.created_at DESC LIMIT 500) s
   WHERE e IS NOT NULL;
  RETURN jsonb_build_object('api_version', 1, 'user_id', v_uid, 'quotes', v_list);
END $$;

REVOKE ALL ON FUNCTION public._earnings_for_quote(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.earnings_sales_rule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.earnings_tech_rule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_company_owner_flag() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_earnings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_earnings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO authenticated;