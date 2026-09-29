CREATE TABLE IF NOT EXISTS public.sales_commission_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL UNIQUE,
  quote_number text,
  company_id uuid NOT NULL,
  rep_id uuid NOT NULL,
  percent numeric NOT NULL,
  items_sell_ex_vat numeric NOT NULL,
  items_cost numeric NOT NULL,
  items_profit numeric NOT NULL,
  commission numeric NOT NULL,
  unknown_cost_count int NOT NULL DEFAULT 0,
  rule jsonb,
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','paid')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  invoice_paid_date date,
  paid_at date,
  paid_by uuid,
  paid_marked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_commission_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Rep or owner reads commission snapshots" ON public.sales_commission_snapshots;
CREATE POLICY "Rep or owner reads commission snapshots" ON public.sales_commission_snapshots
  FOR SELECT TO authenticated USING (rep_id = auth.uid() OR public.is_company_owner(auth.uid(), company_id));
REVOKE ALL ON public.sales_commission_snapshots FROM anon, authenticated;
GRANT SELECT ON public.sales_commission_snapshots TO authenticated;
DO $m$ DECLARE d text := pg_get_functiondef('public._earnings_for_quote(uuid,uuid)'::regprocedure);
  f text := '  v_paid := v_inv_count > 0 AND v_all_paid;';
BEGIN
  IF (length(d) - length(replace(d, f, ''))) / length(f) <> 1 THEN RAISE EXCEPTION 'fragment not found once in _earnings_for_quote'; END IF;
  EXECUTE replace(d, f, '  v_paid := v_inv_count > 0 AND v_all_paid AND COALESCE((SELECT sum(CASE WHEN i.status = ''paid'' THEN COALESCE(i.grand_total,0)
           ELSE COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id AND p.status = ''paid''),0) END)
      FROM public.invoices i
     WHERE (i.quote_id = q.id OR i.id IN (SELECT j.invoice_id FROM public.jobs j WHERE j.quote_id = q.id AND j.invoice_id IS NOT NULL))
       AND COALESCE(i.status,'''') NOT IN (''void'',''voided'',''cancelled'')),0) >= COALESCE(q.total,0) - 0.01;');
END $m$;
CREATE OR REPLACE FUNCTION public._snapshot_sales_commission(p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record; e jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.sales_commission_snapshots WHERE quote_id = p_quote_id) THEN RETURN; END IF;
  SELECT id, quote_number, company_id, sales_engineer_id, status INTO q FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND OR q.sales_engineer_id IS NULL OR q.status IS DISTINCT FROM 'accepted' THEN RETURN; END IF;
  e := public._earnings_for_quote(p_quote_id, q.sales_engineer_id);
  IF e IS NULL OR NOT COALESCE((e->>'paid_in_full')::boolean, false) OR NOT (e ? 'sales') THEN RETURN; END IF;
  INSERT INTO public.sales_commission_snapshots (quote_id, quote_number, company_id, rep_id, percent, items_sell_ex_vat,
      items_cost, items_profit, commission, unknown_cost_count, rule, invoice_paid_date)
  VALUES (q.id, q.quote_number, COALESCE(q.company_id, (SELECT id FROM public.companies WHERE is_master ORDER BY created_at LIMIT 1)),
      q.sales_engineer_id, (e->'sales'->>'percent')::numeric, (e->'sales'->>'items_sell_ex_vat')::numeric,
      (e->'sales'->>'items_cost')::numeric, (e->'sales'->>'items_profit')::numeric, (e->'sales'->>'commission')::numeric,
      COALESCE((e->'sales'->>'unknown_cost_count')::int, 0), e->'sales'->'rule', (e->>'paid_at')::date)
  ON CONFLICT (quote_id) DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION public.trg_snapshot_sales_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q uuid;
BEGIN
  BEGIN
    FOR v_q IN SELECT NEW.quote_id WHERE NEW.quote_id IS NOT NULL
               UNION SELECT j.quote_id FROM public.jobs j WHERE j.invoice_id = NEW.id AND j.quote_id IS NOT NULL LOOP
      PERFORM public._snapshot_sales_commission(v_q);
    END LOOP;
  EXCEPTION WHEN others THEN RAISE WARNING 'sales commission snapshot skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_snapshot_sales_commission ON public.invoices;
CREATE TRIGGER trg_snapshot_sales_commission AFTER INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_snapshot_sales_commission();
CREATE OR REPLACE FUNCTION public._apply_commission_snapshot(e jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN e IS NULL OR s.id IS NULL OR NOT (e ? 'sales') THEN e
    WHEN NOT COALESCE((e->'viewer'->>'is_owner')::boolean, false) AND s.rep_id::text IS DISTINCT FROM (e->'sales'->>'rep_id') THEN e - 'sales'
    ELSE e || jsonb_build_object('paid_in_full', true, 'paid_at', COALESCE(e->>'paid_at', s.invoice_paid_date::text),
      'sales', (e->'sales') || jsonb_build_object('rep_id', s.rep_id, 'is_me', COALESCE((e->'sales'->>'is_me')::boolean, false) AND s.rep_id::text = (e->'sales'->>'rep_id'),
        'percent', s.percent, 'items_sell_ex_vat', s.items_sell_ex_vat, 'items_cost', s.items_cost, 'items_profit', s.items_profit,
        'commission', s.commission, 'unknown_cost_count', s.unknown_cost_count, 'status', CASE WHEN s.status = 'paid' THEN 'paid' ELSE 'earned' END,
        'frozen', true, 'snapshot_id', s.id))
      || CASE WHEN e ? 'company' THEN jsonb_build_object('company', (e->'company') || jsonb_build_object('items_keep', round(s.items_profit - s.commission, 2))) ELSE '{}'::jsonb END
  END
  FROM (SELECT 1) one LEFT JOIN public.sales_commission_snapshots s ON s.quote_id = (e->>'quote_id')::uuid;
$$;
DO $m$ DECLARE d text := pg_get_functiondef('public.get_my_earnings(uuid)'::regprocedure);
BEGIN
  IF position('public._earnings_for_quote(p_quote_id, v_uid)' in d) = 0 OR position('public._earnings_for_quote(qt.id, v_uid) e' in d) = 0 THEN
    RAISE EXCEPTION 'fragment not found in get_my_earnings'; END IF;
  d := replace(d, 'public._earnings_for_quote(p_quote_id, v_uid)', 'public._apply_commission_snapshot(public._earnings_for_quote(p_quote_id, v_uid))');
  EXECUTE replace(d, 'public._earnings_for_quote(qt.id, v_uid) e', 'public._apply_commission_snapshot(public._earnings_for_quote(qt.id, v_uid)) e');
END $m$;
DO $m$ DECLARE d text := pg_get_functiondef('public.get_owner_money_flow(uuid)'::regprocedure);
  f text := 'public._earnings_for_quote(qt.id, v_uid) AS e';
BEGIN
  IF position(f in d) = 0 THEN RAISE EXCEPTION 'fragment not found in get_owner_money_flow'; END IF;
  EXECUTE replace(d, f, 'public._apply_commission_snapshot(public._earnings_for_quote(qt.id, v_uid)) AS e');
END $m$;
CREATE OR REPLACE FUNCTION public.get_sales_tracker(p_rep_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_cos uuid[]; v_master uuid; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_cos := ARRAY(SELECT company_id FROM public.company_members WHERE user_id = v_uid AND role = 'admin' AND is_owner);
  v_master := (SELECT id FROM public.companies WHERE is_master ORDER BY created_at LIMIT 1);
  WITH live AS (
    SELECT qt.id, qt.quote_number, qt.sales_engineer_id AS rep_id, qt.accepted_at,
           public._earnings_for_quote(qt.id, qt.sales_engineer_id) AS e
      FROM public.quotes qt
     WHERE qt.status = 'accepted' AND qt.sales_engineer_id IS NOT NULL
       AND (qt.sales_engineer_id = v_uid OR COALESCE(qt.company_id, v_master) = ANY(v_cos))
       AND (p_rep_id IS NULL OR qt.sales_engineer_id = p_rep_id)
       AND NOT EXISTS (SELECT 1 FROM public.sales_commission_snapshots s WHERE s.quote_id = qt.id)
     ORDER BY qt.created_at DESC LIMIT 500
  ), r AS (
    SELECT CASE WHEN (e->>'paid_in_full')::boolean THEN 'earned' ELSE 'pipeline' END AS grp, false AS frozen,
           NULL::uuid AS snapshot_id, id AS quote_id, quote_number, rep_id,
           (e->'sales'->>'percent')::numeric AS percent, (e->'sales'->>'items_sell_ex_vat')::numeric AS items_sell_ex_vat,
           (e->'sales'->>'items_cost')::numeric AS items_cost, (e->'sales'->>'items_profit')::numeric AS items_profit,
           (e->'sales'->>'commission')::numeric AS commission, COALESCE((e->'sales'->>'unknown_cost_count')::int,0) AS unknown_cost_count,
           accepted_at, NULL::timestamptz AS earned_at, (e->>'paid_at')::date AS invoice_paid_date, NULL::date AS paid_at
      FROM live WHERE e ? 'sales'
    UNION ALL
    SELECT CASE WHEN s.status = 'paid' THEN 'paid_out' ELSE 'earned' END, true, s.id, s.quote_id,
           COALESCE((SELECT quote_number FROM public.quotes WHERE id = s.quote_id), s.quote_number), s.rep_id,
           s.percent, s.items_sell_ex_vat, s.items_cost, s.items_profit, s.commission, s.unknown_cost_count,
           (SELECT accepted_at FROM public.quotes WHERE id = s.quote_id), s.earned_at, s.invoice_paid_date, s.paid_at
      FROM public.sales_commission_snapshots s
     WHERE (s.rep_id = v_uid OR s.company_id = ANY(v_cos)) AND (p_rep_id IS NULL OR s.rep_id = p_rep_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object('rep_name', (SELECT full_name FROM public.profiles WHERE id = r.rep_id))
           ORDER BY r.grp, COALESCE(r.earned_at, r.accepted_at) DESC NULLS LAST), '[]'::jsonb) INTO v_rows FROM r;
  RETURN jsonb_build_object('api_version', 1, 'user_id', v_uid, 'is_owner', cardinality(v_cos) > 0, 'rows', v_rows);
END $$;
CREATE OR REPLACE FUNCTION public.set_commission_paid(p_snapshot_id uuid, p_paid boolean DEFAULT true, p_paid_at date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.sales_commission_snapshots;
BEGIN
  SELECT * INTO s FROM public.sales_commission_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission record not found'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_company_owner(auth.uid(), s.company_id) THEN
    RAISE EXCEPTION 'Only the company owner can mark commission paid out';
  END IF;
  UPDATE public.sales_commission_snapshots
     SET status = CASE WHEN p_paid THEN 'paid' ELSE 'earned' END,
         paid_at = CASE WHEN p_paid THEN COALESCE(p_paid_at, (now() AT TIME ZONE 'Africa/Johannesburg')::date) END,
         paid_by = CASE WHEN p_paid THEN auth.uid() END, paid_marked_at = now()
   WHERE id = p_snapshot_id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;
CREATE OR REPLACE FUNCTION public.guard_log_salesperson_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sales_engineer_id IS NOT DISTINCT FROM OLD.sales_engineer_id THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND NOT (public.has_role(auth.uid(), 'admin')
       OR (public.has_role(auth.uid(), 'dispatcher')
           AND COALESCE((SELECT dispatch_role FROM public.profiles WHERE id = auth.uid()), '') <> 'sales')) THEN
    RAISE EXCEPTION 'Only admin or office can change the salesperson';
  END IF;
  INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
  VALUES ('quote', NEW.id, 'sales_engineer_id', OLD.sales_engineer_id::text, NEW.sales_engineer_id::text, auth.uid(), NEW.company_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_log_salesperson_change ON public.quotes;
CREATE TRIGGER trg_guard_log_salesperson_change BEFORE UPDATE OF sales_engineer_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.guard_log_salesperson_change();
REVOKE ALL ON FUNCTION public._snapshot_sales_commission(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_snapshot_sales_commission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_commission_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_log_salesperson_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_sales_tracker(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_commission_paid(uuid, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_tracker(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_commission_paid(uuid, boolean, date) TO authenticated;