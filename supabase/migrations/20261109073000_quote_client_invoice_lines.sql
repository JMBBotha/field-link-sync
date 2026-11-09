-- Already live on production (Johan, 9 Nov 2026). This migration only records those
-- function bodies so a later deploy or schema reset does not restore an older
-- CREATE OR REPLACE. New invoices from an accepted quote list each quoted unit by
-- name, area, a short description, and the area amount. Materials, labour, and
-- install kits stay folded into those area totals. Existing invoices are not rewritten.

CREATE OR REPLACE FUNCTION public.quote_client_invoice_lines(p_quote_id uuid)
RETURNS TABLE (
  line_name text,
  description text,
  room_label text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  sort_order integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  a record;
  d record;
  v_area_cents bigint;
  v_disp_cents bigint;
  v_extra bigint;
  v_weight bigint;
  v_given bigint;
  v_share bigint;
  v_job_cents bigint;
  v_target numeric;
  v_have_cents bigint;
  v_diff_cents bigint;
  v_note text;
  v_extras text;
  v_room text;
  v_seen int;
  v_cnt int;
BEGIN
  DROP TABLE IF EXISTS _qil_src;
  DROP TABLE IF EXISTS _qil_out;
  CREATE TEMP TABLE _qil_src (
    id uuid,
    area_key text,
    area_name text,
    area_sort int,
    item_name text,
    item_number text,
    description text,
    quantity numeric,
    line_tot numeric,
    item_sort int,
    is_lab boolean,
    is_inst boolean,
    is_svc boolean,
    is_job_lab boolean,
    is_unit boolean
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _qil_out (
    id serial PRIMARY KEY,
    area_key text,
    area_sort int,
    item_sort int,
    line_name text,
    description text,
    room_label text,
    quantity numeric,
    amount_cents bigint,
    extras_note text
  ) ON COMMIT DROP;

  INSERT INTO _qil_src (
    id, area_key, area_name, area_sort, item_name, item_number, description,
    quantity, line_tot, item_sort, is_lab, is_inst, is_svc, is_job_lab, is_unit
  )
  SELECT
    qi.id,
    COALESCE(qi.area_id::text, '__none__'),
    COALESCE(NULLIF(btrim(qa.name), ''), 'General'),
    COALESCE(qa.sort_order, 10000),
    COALESCE(NULLIF(btrim(qi.item_name), ''), 'Item'),
    NULLIF(btrim(qi.item_number), ''),
    NULLIF(btrim(qi.description), ''),
    COALESCE(qi.quantity, 1),
    CASE
      WHEN qi.total_price IS NOT NULL AND qi.total_price <> 0 THEN qi.total_price
      ELSE ROUND(COALESCE(qi.quantity, 0) * COALESCE(qi.unit_price, 0), 2)
    END,
    COALESCE(qi.sort_order, 0),
    lower(trim(COALESCE(qi.item_type, ''))) = 'labour'
      OR COALESCE(qi.metadata->>'labour', '') IN ('true', 't', '1')
      OR (qi.product_id IS NULL AND COALESCE(qi.item_name, '') ~* '^\s*(labou?r\b|installation\s*fee\b|ac\s+installation\s*$|installation\s*$)'),
    COALESCE(qi.is_bundle, false)
      OR COALESCE(qi.metadata->>'kit', '') IN ('true', 't', '1')
      OR COALESCE(qi.metadata->>'install', '') IN ('true', 't', '1')
      OR lower(trim(COALESCE(qi.item_type, ''))) IN ('installation kit', 'consumables')
      OR COALESCE(qi.item_name, '') ~* 'copper|arma ?flex|insulation|lasso|cable tie|trunking|end cap|bracket|flatback|docking channel|pvc pipe|pvc elbow|drain|piping kit',
    lower(trim(COALESCE(qi.item_type, ''))) = 'service'
      OR NULLIF(btrim(COALESCE(qi.metadata->>'catalog_service_id', '')), '') IS NOT NULL,
    false,
    false
  FROM public.quote_items qi
  LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id
  WHERE qi.quote_id = p_quote_id
    AND qi.parent_item_id IS NULL;

  UPDATE _qil_src s
     SET is_job_lab = is_lab AND (
           s.area_key = '__none__'
           OR EXISTS (
             SELECT 1 FROM public.quote_items qi
              WHERE qi.id = s.id AND qi.metadata->>'labour_scope' = 'job'
           )
         );

  UPDATE _qil_src s
     SET is_unit = (NOT is_lab AND NOT is_inst AND NOT is_svc)
       AND s.item_name !~* '(pump|condensate|bracket|trunking|piping kit|ee600)'
       AND COALESCE(s.description, '') !~* '(condensate pump|\bpump\b|ee600)'
       AND COALESCE(s.item_number, '') !~* '(ee600|pump)'
       AND (
         s.item_name ~* '(inverter|mid-?wall|cassette|under\s*ceiling|console|ducted|split|air\s*con|aircon)'
         OR EXISTS (
           SELECT 1
             FROM public.quote_items qi
             LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
            WHERE qi.id = s.id
              AND (
                COALESCE(sp.btu_rating, 0) > 0
                OR COALESCE(sp.capacity_btu, 0) > 0
                OR COALESCE(sp.kw, 0) > 0
                OR COALESCE(sp.category, '') ~* '(air\s*con|aircon|midwall|mid-wall|inverter|cassette|under\s*ceiling|underceiling|console|ducted|split)'
              )
         )
       );

  SELECT COALESCE(SUM(ROUND(line_tot * 100)), 0) INTO v_job_cents
    FROM _qil_src WHERE is_job_lab AND line_tot <> 0;

  FOR a IN
    SELECT area_key, MIN(area_name) AS area_name, MIN(area_sort) AS area_sort
      FROM _qil_src
     GROUP BY area_key
     ORDER BY MIN(area_sort), MIN(area_name)
  LOOP
    v_room := CASE WHEN a.area_key = '__none__' THEN NULL ELSE a.area_name END;

    IF EXISTS (SELECT 1 FROM _qil_src s WHERE s.area_key = a.area_key AND s.is_unit AND s.line_tot <> 0) THEN
      INSERT INTO _qil_out (area_key, area_sort, item_sort, line_name, description, room_label, quantity, amount_cents)
      SELECT a.area_key, a.area_sort, s.item_sort,
             CASE WHEN s.item_number IS NOT NULL AND s.item_name NOT ILIKE '%' || s.item_number || '%'
                  THEN s.item_name || ' (' || s.item_number || ')' ELSE s.item_name END,
             NULLIF(btrim(regexp_replace(regexp_replace(
               split_part(COALESCE(s.description, ''), E'\n', 1),
               '[,\s;]*(and\s+)?[0-9]+([.,][0-9]+)?\s*m\s+copper pipe kit included[.\s]*', '', 'i'),
               '([0-9])([0-9]{3} BTU)', '\1,\2', 'i')), ''),
             v_room,
             CASE WHEN s.quantity IS NULL OR s.quantity = 0 THEN 1 ELSE s.quantity END,
             ROUND(s.line_tot * 100)
        FROM _qil_src s
       WHERE s.area_key = a.area_key AND s.is_unit AND s.line_tot <> 0
       ORDER BY s.item_sort, s.item_name;
    ELSIF EXISTS (SELECT 1 FROM _qil_src s WHERE s.area_key = a.area_key AND s.is_svc AND NOT s.is_lab AND s.line_tot <> 0) THEN
      INSERT INTO _qil_out (area_key, area_sort, item_sort, line_name, description, room_label, quantity, amount_cents)
      SELECT a.area_key, a.area_sort, s.item_sort, s.item_name,
             NULLIF(btrim(split_part(COALESCE(s.description, ''), E'\n', 1)), ''),
             v_room,
             CASE WHEN s.quantity IS NULL OR s.quantity = 0 THEN 1 ELSE s.quantity END,
             ROUND(s.line_tot * 100)
        FROM _qil_src s
       WHERE s.area_key = a.area_key AND s.is_svc AND NOT s.is_lab AND s.line_tot <> 0
       ORDER BY s.item_sort, s.item_name;
    ELSE
      INSERT INTO _qil_out (area_key, area_sort, item_sort, line_name, description, room_label, quantity, amount_cents)
      SELECT a.area_key, a.area_sort, s.item_sort,
             CASE WHEN s.item_number IS NOT NULL AND s.item_name NOT ILIKE '%' || s.item_number || '%'
                  THEN s.item_name || ' (' || s.item_number || ')' ELSE s.item_name END,
             NULLIF(btrim(split_part(COALESCE(s.description, ''), E'\n', 1)), ''),
             v_room,
             CASE WHEN s.quantity IS NULL OR s.quantity = 0 THEN 1 ELSE s.quantity END,
             ROUND(s.line_tot * 100)
        FROM _qil_src s
       WHERE s.area_key = a.area_key AND NOT s.is_lab AND NOT s.is_inst AND NOT s.is_job_lab AND s.line_tot <> 0
       ORDER BY s.item_sort, s.item_name;
    END IF;

    SELECT COALESCE(SUM(ROUND(line_tot * 100)), 0) INTO v_area_cents
      FROM _qil_src WHERE area_key = a.area_key AND NOT is_job_lab;

    IF NOT EXISTS (SELECT 1 FROM _qil_out o WHERE o.area_key = a.area_key) THEN
      IF v_area_cents <> 0 THEN
        INSERT INTO _qil_out (area_key, area_sort, item_sort, line_name, description, room_label, quantity, amount_cents)
        VALUES (a.area_key, a.area_sort, 0, 'Installation / service', NULL, v_room, 1, v_area_cents);
      ELSE
        CONTINUE;
      END IF;
    END IF;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_disp_cents FROM _qil_out WHERE area_key = a.area_key;
    v_extra := v_area_cents - v_disp_cents;

    SELECT string_agg(DISTINCT x.nm, ' and ' ORDER BY x.nm)
      INTO v_extras
      FROM (
        SELECT CASE
                 WHEN s.item_name ~* 'ee600|condensate|\bpump\b' OR COALESCE(s.description, '') ~* 'condensate|\bpump\b'
                   THEN 'a condensate pump'
                 WHEN s.item_name ~* 'installation|labou?r'
                   THEN NULL
                 ELSE NULLIF(btrim(split_part(s.item_name, ' - ', 1)), '')
               END AS nm
          FROM _qil_src s
         WHERE s.area_key = a.area_key
           AND NOT s.is_lab AND NOT s.is_inst AND NOT s.is_job_lab AND s.line_tot <> 0
           AND NOT EXISTS (
             SELECT 1 FROM _qil_out o
              WHERE o.area_key = s.area_key
                AND (o.line_name = s.item_name
                     OR (s.item_number IS NOT NULL AND o.line_name = s.item_name || ' (' || s.item_number || ')'))
           )
      ) x
     WHERE x.nm IS NOT NULL;

    IF v_extra <> 0 OR EXISTS (
         SELECT 1 FROM _qil_src s
          WHERE s.area_key = a.area_key AND (s.is_lab OR s.is_inst) AND NOT s.is_job_lab AND s.line_tot <> 0
       ) THEN
      v_note := 'including installation';
      IF v_extras IS NOT NULL AND v_extras <> '' THEN
        v_note := v_note || ' and ' || v_extras;
      END IF;
      UPDATE _qil_out SET extras_note = v_note WHERE area_key = a.area_key;
    END IF;

    IF v_extra <> 0 THEN
      SELECT COALESCE(SUM(amount_cents), 0), COUNT(*) INTO v_weight, v_cnt
        FROM _qil_out WHERE area_key = a.area_key;
      v_given := 0;
      v_seen := 0;
      FOR d IN SELECT id, amount_cents FROM _qil_out WHERE area_key = a.area_key ORDER BY id LOOP
        v_seen := v_seen + 1;
        IF v_seen = v_cnt THEN
          v_share := v_extra - v_given;
        ELSIF v_weight = 0 THEN
          v_share := trunc(v_extra / v_cnt);
          v_given := v_given + v_share;
        ELSE
          v_share := trunc((v_extra * d.amount_cents) / v_weight);
          v_given := v_given + v_share;
        END IF;
        UPDATE _qil_out SET amount_cents = amount_cents + v_share WHERE id = d.id;
      END LOOP;
    END IF;
  END LOOP;

  IF v_job_cents <> 0 THEN
    SELECT COALESCE(SUM(amount_cents), 0), COUNT(*) INTO v_weight, v_cnt FROM _qil_out;
    IF v_cnt = 0 THEN
      INSERT INTO _qil_out (area_key, area_sort, item_sort, line_name, description, room_label, quantity, amount_cents)
      VALUES ('__none__', 10000, 0, 'Installation / service', NULL, NULL, 1, v_job_cents);
    ELSE
      v_given := 0;
      v_seen := 0;
      FOR d IN SELECT id, amount_cents FROM _qil_out ORDER BY id LOOP
        v_seen := v_seen + 1;
        IF v_seen = v_cnt THEN
          v_share := v_job_cents - v_given;
        ELSIF v_weight = 0 THEN
          v_share := trunc(v_job_cents / v_cnt);
          v_given := v_given + v_share;
        ELSE
          v_share := trunc((v_job_cents * d.amount_cents) / v_weight);
          v_given := v_given + v_share;
        END IF;
        UPDATE _qil_out SET amount_cents = amount_cents + v_share WHERE id = d.id;
      END LOOP;
    END IF;
  END IF;

  SELECT ROUND(COALESCE(total, 0) - COALESCE(vat_amount, 0), 2)
    INTO v_target
    FROM public.quotes WHERE id = p_quote_id;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_have_cents FROM _qil_out;
  IF v_target IS NOT NULL AND EXISTS (SELECT 1 FROM _qil_out) THEN
    v_diff_cents := ROUND(v_target * 100) - v_have_cents;
    IF v_diff_cents <> 0 THEN
      UPDATE _qil_out
         SET amount_cents = amount_cents + v_diff_cents
       WHERE id = (SELECT id FROM _qil_out ORDER BY id DESC LIMIT 1);
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    o.line_name,
    NULLIF(btrim(concat_ws(', ', NULLIF(btrim(o.description), ''), o.extras_note)), ''),
    o.room_label,
    o.quantity,
    ROUND(o.amount_cents / 100.0 / NULLIF(o.quantity, 0), 2),
    ROUND(o.amount_cents / 100.0, 2),
    ROW_NUMBER() OVER (ORDER BY o.area_sort, o.item_sort, o.id)::int
  FROM _qil_out o
  WHERE o.amount_cents <> 0
  ORDER BY o.area_sort, o.item_sort, o.id;
END
$function$;

REVOKE ALL ON FUNCTION public.quote_client_invoice_lines(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes%ROWTYPE; cust record; v_existing uuid; v_pct numeric; v_number text;
  v_subtotal numeric; v_vat numeric; v_total numeric; v_rate numeric; v_agent uuid; v_id uuid; v_dep numeric;
  v_lines jsonb;
BEGIN
  IF COALESCE(current_setting('app.public_quote_accept', true), '') IS DISTINCT FROM p_quote_id::text THEN PERFORM public.rh_assert(false); END IF; /*rh1*/
  PERFORM pg_advisory_xact_lock(hashtextextended('deposit_invoice:' || p_quote_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('balance_invoice:' || p_quote_id::text, 0));
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(current_setting('app.public_quote_accept', true), '') IS DISTINCT FROM p_quote_id::text AND COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not authorized for this quote' USING ERRCODE = '42501'; END IF; /*xco*/
  -- oneinv: any live invoice on this quote = done (idempotent)
  SELECT id INTO v_existing FROM public.invoices WHERE quote_id = q.id AND COALESCE(status,'') NOT IN ('void','cancelled') ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(default_deposit_percentage, 70) INTO v_pct FROM public.company_settings
   WHERE company_id = COALESCE(q.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1))
   ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*inv1*/ /*p4cs*/
  v_pct := COALESCE(v_pct, 70); IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 70; END IF;
  IF public.payment_plan_ok(q.payment_plan) AND q.payment_plan IS NOT NULL THEN v_pct := (q.payment_plan->'stages'->0->>'pct')::numeric; END IF; /*acct1*/

  v_total := ROUND(COALESCE(q.total, 0), 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0), 2);
  v_subtotal := v_total - v_vat;
  v_dep := ROUND(v_total * v_pct / 100.0, 2);
  v_rate := COALESCE(q.vat_rate, 0.15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN RETURN NULL; END IF;
  v_number := public.generate_invoice_number();

  -- Johan 9 Nov 2026: client invoices list each quoted unit by name, area, a short
  -- description, and the area total. Materials and labour are folded in, not listed.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'description', l.description,
           'line_name', l.line_name,
           'name', l.line_name,
           'room_label', l.room_label,
           'quantity', l.quantity,
           'rate', l.unit_price,
           'unit_price', l.unit_price,
           'amount', l.amount
         ) ORDER BY l.sort_order), '[]'::jsonb)
    INTO v_lines
    FROM public.quote_client_invoice_lines(q.id) l;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    v_lines := jsonb_build_array(jsonb_build_object(
      'description', 'Quote ' || COALESCE(q.quote_number, '') || ' as accepted',
      'quantity', 1, 'rate', v_subtotal, 'amount', v_subtotal));
  END IF;

  INSERT INTO public.invoices (quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes, deposit_type, deposit_value)
  VALUES (q.id, q.lead_id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_subtotal, v_rate, v_vat, v_total, CURRENT_DATE + 30, 'draft',
    v_lines,
    q.company_id,
    'Quote ' || COALESCE(q.quote_number, '') || ': total R ' || to_char(v_total,'FM999999990.00') || ' incl VAT. ' || ROUND(v_pct)::text
      || '% deposit R ' || to_char(v_dep,'FM999999990.00') || ' due now; balance R ' || to_char(v_total - v_dep,'FM999999990.00') || ' on completion.',
    'percent', v_pct)
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, line_name, room_label, quantity, unit_price, amount, sort_order, vat_rate)
  SELECT v_id,
         COALESCE(NULLIF(btrim(e->>'description'), ''), e->>'line_name', 'Item'),
         NULLIF(btrim(e->>'line_name'), ''),
         NULLIF(btrim(e->>'room_label'), ''),
         COALESCE((e->>'quantity')::numeric, 1),
         COALESCE((e->>'rate')::numeric, (e->>'unit_price')::numeric),
         (e->>'amount')::numeric,
         (ord - 1)::integer,
         v_rate
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS t(e, ord);

  -- 0025: alert rep + company admins ("<Client> accepted Q-xxxx") and queue the timed send (default 15 min).
  PERFORM public.isa_queue(v_id);
  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.create_deposit_invoice_for_quote(uuid) IS
  'Creates the deposit invoice when a quote is accepted. Line items are the quoted units by area with folded installation totals (Johan 9 Nov 2026), not a single Quote … as accepted line.';
