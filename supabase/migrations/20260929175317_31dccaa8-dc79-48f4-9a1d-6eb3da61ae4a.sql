-- ROLLBACK:
--   For each quote with labour_mode='job': SELECT public.set_quote_labour_mode(id, 'per_area', 3.5, <area unit counts jsonb>);
--   DROP FUNCTION public.set_quote_labour_mode(uuid, text, numeric, jsonb);
--   ALTER TABLE public.quotes DROP COLUMN labour_mode;

ALTER TABLE public.quotes ADD COLUMN labour_mode text NOT NULL DEFAULT 'per_area' CHECK (labour_mode IN ('per_area','job'));

CREATE OR REPLACE FUNCTION public.set_quote_labour_mode(p_quote_id uuid, p_mode text, p_per_unit_hours numeric, p_area_units jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cur text;
  v_h numeric;
  v_rate numeric;
  v_rates int;
  v_sum numeric := 0;
  v_diff numeric;
  v_first uuid;
  r record;
  v_hours numeric;
  v_sort int;
BEGIN
  IF p_mode NOT IN ('per_area','job') THEN RAISE EXCEPTION 'Invalid labour mode %', p_mode; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_quote_id::text));
  SELECT labour_mode INTO v_cur FROM quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_cur = p_mode THEN RETURN; END IF;
  SELECT coalesce(max(sort_order), 0) + 1 INTO v_sort FROM quote_items WHERE quote_id = p_quote_id;

  IF p_mode = 'job' THEN
    SELECT coalesce(sum(quantity), 0), count(DISTINCT unit_price), min(unit_price)
      INTO v_h, v_rates, v_rate
      FROM quote_items
     WHERE quote_id = p_quote_id AND item_type = 'labour' AND parent_item_id IS NULL
       AND area_id IS NOT NULL;
    IF v_rates <> 1 THEN v_rate := 680; END IF;
    INSERT INTO quote_items (quote_id, area_id, item_name, item_type, quantity, unit_price, total_price, source, sort_order,
                             allows_decimal_qty, qty_step, min_qty, metadata)
    VALUES (p_quote_id, NULL, 'Job labour', 'labour', v_h, v_rate, round(v_h * v_rate, 2), 'labour', v_sort, true, 0.5, 0,
      jsonb_build_object('labour', true, 'labour_scope', 'job', 'hours', v_h, 'rate', v_rate, 'unit_cost', v_rate,
        'cost_excl', v_rate, 'total_cost', round(v_h * v_rate, 2), 'markup_percent', 0, 'price_locked', true,
        'rate_overridden', false, 'labour_auto', false));
    DELETE FROM quote_items
     WHERE quote_id = p_quote_id AND item_type = 'labour' AND parent_item_id IS NULL AND area_id IS NOT NULL;
  ELSE
    SELECT coalesce(sum(quantity), 0), min(unit_price) INTO v_h, v_rate
      FROM quote_items
     WHERE quote_id = p_quote_id AND item_type = 'labour' AND parent_item_id IS NULL
       AND area_id IS NULL AND metadata->>'labour_scope' = 'job';
    v_rate := coalesce(v_rate, 680);
    DROP TABLE IF EXISTS _qlm_plan;
    CREATE TEMP TABLE _qlm_plan (area_id uuid, ord integer, hours numeric, dflt numeric) ON COMMIT DROP;
    INSERT INTO _qlm_plan (area_id, ord, hours, dflt)
      SELECT a.id, a.sort_order,
             round(p_per_unit_hours * coalesce(nullif(p_area_units ->> (a.id::text), '')::numeric, 0), 2),
             round(p_per_unit_hours * coalesce(nullif(p_area_units ->> (a.id::text), '')::numeric, 0), 2)
        FROM quote_areas a WHERE a.quote_id = p_quote_id;
    SELECT coalesce(sum(hours), 0) INTO v_sum FROM _qlm_plan;
    v_diff := v_h - v_sum;
    SELECT area_id INTO v_first FROM _qlm_plan ORDER BY (hours > 0) DESC, ord LIMIT 1;
    IF v_first IS NOT NULL THEN
      IF v_diff >= 0 THEN
        UPDATE _qlm_plan SET hours = hours + v_diff WHERE area_id = v_first;
      ELSE
        FOR r IN SELECT area_id, hours FROM _qlm_plan WHERE hours > 0 ORDER BY ord LOOP
          EXIT WHEN v_diff >= 0;
          v_hours := least(r.hours, -v_diff);
          UPDATE _qlm_plan SET hours = hours - v_hours WHERE area_id = r.area_id;
          v_diff := v_diff + v_hours;
        END LOOP;
      END IF;
      INSERT INTO quote_items (quote_id, area_id, item_name, item_type, quantity, unit_price, total_price, source, sort_order,
                               allows_decimal_qty, qty_step, min_qty, metadata)
      SELECT p_quote_id, p.area_id, 'Labour', 'labour', p.hours, v_rate, round(p.hours * v_rate, 2), 'labour', v_sort + p.ord, true, 0.5, 0,
        jsonb_build_object('labour', true, 'hours', p.hours, 'rate', v_rate, 'unit_cost', v_rate, 'cost_excl', v_rate,
          'total_cost', round(p.hours * v_rate, 2), 'markup_percent', 0, 'price_locked', true, 'rate_overridden', false,
          'labour_auto', (p.hours = p.dflt))
        FROM _qlm_plan p WHERE p.hours > 0;
      DELETE FROM quote_items
       WHERE quote_id = p_quote_id AND item_type = 'labour' AND parent_item_id IS NULL
         AND area_id IS NULL AND metadata->>'labour_scope' = 'job';
    END IF;
    -- No areas: keep the job row so no hours are lost.
  END IF;

  UPDATE quotes SET labour_mode = p_mode WHERE id = p_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_quote_labour_mode(uuid, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_quote_labour_mode(uuid, text, numeric, jsonb) TO authenticated;