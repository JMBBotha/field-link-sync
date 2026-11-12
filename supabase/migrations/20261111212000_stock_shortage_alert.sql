-- Material use still posts the full quantity to the ledger and still floors the on-hand cache at zero.
-- A shortfall is now a stock_shortages row and an in-app alert. Reservations are unchanged.
-- No prices are included in the alert.

CREATE TABLE IF NOT EXISTS public.stock_shortages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  stock_item_id uuid,
  allowance_id uuid,
  item_label text,
  needed numeric NOT NULL,
  on_hand numeric NOT NULL,
  shortfall numeric NOT NULL CHECK (shortfall > 0),
  movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_shortages_job_allowance_uidx
  ON public.stock_shortages (job_id, allowance_id)
  WHERE allowance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_shortages_company ON public.stock_shortages (company_id, created_at DESC);
ALTER TABLE public.stock_shortages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_shortages_read ON public.stock_shortages;
CREATE POLICY stock_shortages_read ON public.stock_shortages
  FOR SELECT TO authenticated
  USING (
    public.fl_is_company_office(auth.uid(), company_id)
    OR public.fl_is_company_admin(auth.uid(), company_id)
  );
COMMENT ON TABLE public.stock_shortages IS
  'Material use that exceeded the on-hand cache. The ledger still records the full use. This row is the shortage the cache would otherwise hide.';

CREATE OR REPLACE FUNCTION public.job_apply_material_allowances(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; r record; v_item uuid; v_avg numeric; v_qty numeric; v_label text; v_id uuid;
  n_post int := 0; n_already int := 0; n_skip int := 0; n_short int := 0; v_on date := CURRENT_DATE;
  v_have numeric; v_short numeric; v_uid uuid; v_shorts jsonb := '[]'::jsonb;
BEGIN
  IF NOT public._job_stock_ok(p_job) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id, quote_id, job_type INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  FOR r IN
    WITH units AS (
      SELECT public.stock_unit_size_key(coalesce(su.supplier_code, sp.product_code, sp.name)) AS size, su.half, 1::numeric AS n
        FROM public.stock_units su
        LEFT JOIN public.supplier_products sp ON sp.id = su.product_id
       WHERE su.company_id = j.company_id AND (
         su.received_job_id = p_job
         OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.unit_id = su.id AND m.job_id = p_job AND m.bucket = 'job_unit' AND m.kind = 'allocate' AND m.qty > 0)
       )
    ),
    sized AS (
      SELECT size,
             CASE WHEN coalesce(sum(n) FILTER (WHERE half IS NOT NULL), 0) > 0
                  THEN greatest(coalesce(sum(n) FILTER (WHERE half = 'indoor'), 0), coalesce(sum(n) FILTER (WHERE half = 'outdoor'), 0))
                  ELSE coalesce(sum(n), 0) END AS systems
        FROM units WHERE size IS NOT NULL GROUP BY size
    ),
    quoted AS (
      SELECT public.stock_unit_size_key(coalesce(sp.product_code, sp.name, qi.item_name)) AS size,
             sum(coalesce(qi.quantity, 0)) AS systems
        FROM public.quote_items qi
        LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
       WHERE j.quote_id IS NOT NULL AND qi.quote_id = j.quote_id AND sp.product_type = 'ac_unit'
       GROUP BY 1
    ),
    systems AS (
      SELECT * FROM sized
      UNION ALL
      SELECT q.size, q.systems FROM quoted q
       WHERE NOT EXISTS (SELECT 1 FROM sized) AND q.size IS NOT NULL
    )
    SELECT a.id AS allowance_id, a.product_id, a.item_label, a.qty * s.systems AS use_qty, s.systems
      FROM systems s
      JOIN public.material_allowances a ON a.company_id = j.company_id AND a.active AND a.qty > 0
       AND a.effective_from <= v_on AND (a.effective_to IS NULL OR a.effective_to >= v_on)
       AND a.unit_size = s.size
       AND (a.job_type IS NULL OR j.job_type IS NULL OR a.job_type = j.job_type)
     WHERE s.systems > 0
    UNION ALL
    SELECT a.id, a.product_id, a.item_label, a.qty * t.systems, t.systems
      FROM (SELECT coalesce(sum(systems), 0) AS systems FROM systems) t
      JOIN public.material_allowances a ON a.company_id = j.company_id AND a.active AND a.qty > 0
       AND a.unit_size IS NULL AND a.job_type IS NOT NULL AND a.job_type = j.job_type
       AND a.effective_from <= v_on AND (a.effective_to IS NULL OR a.effective_to >= v_on)
     WHERE t.systems > 0
  LOOP
    IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.job_id = p_job AND m.allowance_id = r.allowance_id AND m.kind = 'use') THEN
      n_already := n_already + 1; CONTINUE;
    END IF;
    SELECT s.id INTO v_item FROM public.cf_stock_items s
     WHERE s.company_id = j.company_id AND s.active
       AND ((r.product_id IS NOT NULL AND s.product_id = r.product_id) OR upper(s.item) = upper(r.item_label))
     ORDER BY (s.product_id IS NOT DISTINCT FROM r.product_id) DESC, s.created_at LIMIT 1;
    v_avg := CASE WHEN v_item IS NULL THEN NULL ELSE public.material_avg_cost(v_item, now()) END;
    IF v_item IS NULL OR v_avg IS NULL THEN n_skip := n_skip + 1; CONTINUE; END IF;
    v_qty := round(r.use_qty, 3);
    IF v_qty <= 0 THEN n_skip := n_skip + 1; CONTINUE; END IF;
    v_label := r.item_label;
    SELECT coalesce(qty_on_hand, 0) INTO v_have FROM public.cf_stock_items WHERE id = v_item FOR UPDATE;
    v_short := greatest(0, round(v_qty - coalesce(v_have, 0), 3));
    v_id := public._stock_move(j.company_id, 'use', 'material_pool', v_item, r.product_id, v_label,
      -v_qty, v_avg, NULL, p_job, NULL, NULL, NULL, NULL, 'Install allowance', r.allowance_id, NULL, NULL);
    UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - v_qty), updated_at = now() WHERE id = v_item;
    IF v_short > 0 THEN
      INSERT INTO public.stock_shortages (company_id, job_id, stock_item_id, allowance_id, item_label, needed, on_hand, shortfall, movement_id)
      VALUES (j.company_id, p_job, v_item, r.allowance_id, v_label, v_qty, coalesce(v_have, 0), v_short, v_id);
      v_shorts := v_shorts || jsonb_build_array(jsonb_build_object(
        'label', v_label, 'needed', v_qty, 'on_hand', coalesce(v_have, 0), 'shortfall', v_short, 'stock_item_id', v_item));
      n_short := n_short + 1;
      -- The shortage row stays with the stock movement. A failed alert must not undo the use.
      BEGIN
        IF to_regprocedure('public.fl_alert_deliver(uuid,text,text,text,uuid,jsonb)') IS NOT NULL THEN
          FOR v_uid IN SELECT public.fl_company_admin_ids(j.company_id) LOOP
            PERFORM public.fl_alert_deliver(
              v_uid, 'stock_shortage', 'Stock short',
              v_label || ' is short by ' || trim(to_char(v_short, 'FM999990.000')) || ' on this job. The office has been told.',
              p_job,
              jsonb_build_object('stock_item_id', v_item, 'allowance_id', r.allowance_id, 'needed', v_qty, 'on_hand', coalesce(v_have, 0), 'shortfall', v_short));
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'stock shortage alert skipped for job %: %', p_job, SQLERRM;
      END;
    END IF;
    n_post := n_post + 1;
  END LOOP;
  RETURN jsonb_build_object('posted', n_post, 'already', n_already, 'skipped', n_skip, 'short', n_short, 'shortages', v_shorts);
END $$;

REVOKE ALL ON FUNCTION public.job_apply_material_allowances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_apply_material_allowances(uuid) TO authenticated;
