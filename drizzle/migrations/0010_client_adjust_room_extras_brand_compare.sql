CREATE OR REPLACE FUNCTION public.qcr_style(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~* 'cassette' THEN 'cassette' WHEN p ~* 'duct' THEN 'ducted'
    WHEN p ~* 'under ?ceiling|ceiling' THEN 'ceiling' WHEN p ~* 'floor' THEN 'floor'
    WHEN p ~* 'portable' THEN 'portable' WHEN p ~* 'window' THEN 'window' ELSE 'wall' END $$;
CREATE OR REPLACE FUNCTION public.qcr_drive(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~* 'fixed' THEN 'fixed' WHEN p ~* 'inv' THEN 'inverter' ELSE 'any' END $$;
CREATE OR REPLACE FUNCTION public.qcr_items(p_quote_id uuid)
 RETURNS TABLE (id uuid, area_id uuid, is_unit boolean, link uuid, amount numeric, qty numeric, unit_price numeric,
   product_id uuid, name text, brand text, btu int, area_name text, image_url text, cost numeric, sort int)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH b AS (
    SELECT qi.id, qi.area_id,
      public.qcr_is_unit(qi.item_name, qi.item_type, qi.product_id IS NOT NULL, COALESCE(sp.btu_rating, sp.capacity_btu), sp.category) AND COALESCE(qi.quantity,0) > 0 AS is_unit,
      NULLIF(qi.metadata->'install'->>'unit_item_id','')::uuid AS link,
      COALESCE(qi.total_price, COALESCE(qi.quantity,0)*COALESCE(qi.unit_price,0)) AS amount, COALESCE(qi.quantity,0) AS qty,
      COALESCE(qi.unit_price, COALESCE(qi.total_price,0)/NULLIF(qi.quantity,0), 0) AS unit_price,
      qi.product_id, COALESCE(qi.item_name, qi.description, 'Unit') AS name, sp.brand, COALESCE(sp.btu_rating, sp.capacity_btu) AS btu,
      qa.name AS area_name, sp.image_url, sp.cost_price AS cost, COALESCE(qi.sort_order,0) AS sort
    FROM public.quote_items qi
    LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
    LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id
    WHERE qi.quote_id = p_quote_id AND qi.parent_item_id IS NULL)
  SELECT b.id, b.area_id, b.is_unit,
    CASE WHEN EXISTS (SELECT 1 FROM b u WHERE u.id = b.link AND u.is_unit) THEN b.link END,
    b.amount, b.qty, b.unit_price, b.product_id, b.name, b.brand, b.btu, b.area_name, b.image_url, b.cost, b.sort FROM b $$;
REVOKE ALL ON FUNCTION public.qcr_items(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.qcr_pricing(p_quote_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q public.quotes%ROWTYPE; v_lines jsonb; v_area jsonb; v_job numeric := 0; v_all numeric := 0; v_disc_pct numeric := 0;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RETURN NULL; END IF;
  IF q.discount_type IN ('percent','percentage') THEN v_disc_pct := COALESCE(q.discount_value,0); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('area_id', a.area_id, 'amount', a.amt)), '[]'::jsonb) INTO v_area FROM (
    SELECT t.area_id, round(sum(t.amount),2) amt FROM public.qcr_items(p_quote_id) t
    WHERE NOT t.is_unit AND t.link IS NULL AND t.area_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.qcr_items(p_quote_id) u WHERE u.is_unit AND u.area_id = t.area_id)
    GROUP BY t.area_id) a;
  SELECT round(COALESCE(sum(t.amount),0),2) INTO v_job FROM public.qcr_items(p_quote_id) t
    WHERE NOT t.is_unit AND t.link IS NULL
      AND (t.area_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.qcr_items(p_quote_id) u WHERE u.is_unit AND u.area_id = t.area_id));
  SELECT COALESCE(sum(amount),0) INTO v_all FROM public.qcr_items(p_quote_id) WHERE is_unit;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sort')::int), '[]'::jsonb) INTO v_lines FROM (
    SELECT jsonb_build_object(
      'sort', u.sort, 'item_id', u.id, 'product_id', u.product_id, 'name', u.name, 'brand', u.brand, 'btu', u.btu,
      'area_id', u.area_id, 'area_name', u.area_name, 'image_url', u.image_url, 'quantity', u.qty,
      'raw_unit', round(u.unit_price,2), 'own_extras', e.own, 'share', e.share,
      'install_per_unit', round((e.own + e.share)/NULLIF(u.qty,0),2),
      'unit_price', round(u.unit_price + (e.own + e.share)/NULLIF(u.qty,0), 2),
      'alternatives', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('product_id', a.id, 'name', a.nm, 'brand', a.brand, 'btu', a.btu, 'image_url', a.image_url,
            'raw_unit', a.raw, 'unit_price', round(a.raw + (e.own + e.share)/NULLIF(u.qty,0), 2)) ORDER BY a.raw)
        FROM (
          SELECT DISTINCT ON (lower(sp.brand)) sp.id, COALESCE(sp.short_name, sp.name) nm, sp.brand, COALESCE(sp.btu_rating, sp.capacity_btu) btu, sp.image_url,
            round(sp.cost_price * CASE WHEN COALESCE(u.cost,0) > 0 THEN u.unit_price / u.cost ELSE 1 + COALESCE(sp.default_markup_percent,20)/100 END, 2) raw
          FROM public.supplier_products sp
          WHERE u.btu IS NOT NULL AND sp.is_active AND NOT COALESCE(sp.archived,false) AND NOT COALESCE(sp.is_price_on_request,false)
            AND sp.cost_price > 0 AND sp.brand IS NOT NULL AND lower(sp.brand) <> lower(COALESCE(u.brand,''))
            AND COALESCE(sp.category,'') !~* 'consumable|kit' AND COALESCE(sp.product_code,'') NOT ILIKE '%~hist%'
            AND COALESCE(sp.btu_rating, sp.capacity_btu) BETWEEN u.btu * 0.9 AND u.btu * 1.1
            AND public.qcr_style(COALESCE(sp.short_name,'') || ' ' || COALESCE(sp.name,'') || ' ' || COALESCE(sp.category,''))
                = public.qcr_style(u.name || ' ' || COALESCE((SELECT category FROM public.supplier_products WHERE id = u.product_id),''))
          ORDER BY lower(sp.brand),
            (public.qcr_drive(COALESCE(sp.short_name,'') || ' ' || COALESCE(sp.name,'')) <> public.qcr_drive(u.name)),
            sp.cost_price
        ) a), '[]'::jsonb)
    ) x
    FROM public.qcr_items(p_quote_id) u
    CROSS JOIN LATERAL (
      SELECT round(COALESCE((SELECT sum(o.amount) FROM public.qcr_items(p_quote_id) o WHERE NOT o.is_unit AND o.link = u.id),0),2) own,
        round(
          COALESCE((SELECT (a->>'amount')::numeric FROM jsonb_array_elements(v_area) a WHERE (a->>'area_id')::uuid = u.area_id),0)
            * u.amount / NULLIF((SELECT sum(z.amount) FROM public.qcr_items(p_quote_id) z WHERE z.is_unit AND z.area_id = u.area_id),0)
          + v_job * u.amount / NULLIF(v_all,0), 2) share
    ) e
    WHERE u.is_unit) s(x);

  RETURN jsonb_build_object('lines', v_lines, 'catalogue', '[]'::jsonb, 'shared_by_area', v_area, 'job_shared', v_job,
    'discount_pct', v_disc_pct, 'discount_fixed', CASE WHEN v_disc_pct = 0 THEN COALESCE(q.discount_value,0) ELSE 0 END,
    'vat_rate', CASE WHEN COALESCE(q.vat_rate,0.15) > 1 THEN q.vat_rate/100 ELSE COALESCE(q.vat_rate,0.15) END,
    'original_total', q.total);
END $function$;

CREATE OR REPLACE FUNCTION public.qcr_revision_totals(pr jsonb, p_lines jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE l jsonb; src jsonb; alt jsonb; out jsonb := '[]'::jsonb; v_sub numeric := 0; v_disc numeric; v_vat numeric;
  v_raw numeric; v_name text; v_pid text; kept_areas text[] := '{}'; a jsonb; seen text[] := '{}';
BEGIN
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT e INTO src FROM jsonb_array_elements(pr->'lines') e WHERE e->>'item_id' = l->>'item_id';
    IF src IS NULL THEN RAISE EXCEPTION 'A unit is no longer available. Please refresh the page.'; END IF;
    IF (l->>'item_id') = ANY(seen) THEN CONTINUE; END IF;
    seen := seen || (l->>'item_id');
    v_raw := (src->>'raw_unit')::numeric; v_name := src->>'name'; v_pid := src->>'product_id'; alt := NULL;
    IF NULLIF(l->>'product_id','') IS NOT NULL AND l->>'product_id' IS DISTINCT FROM src->>'product_id' THEN
      SELECT e INTO alt FROM jsonb_array_elements(src->'alternatives') e WHERE e->>'product_id' = l->>'product_id';
      IF alt IS NULL THEN RAISE EXCEPTION 'That option is no longer available. Please refresh the page.'; END IF;
      v_raw := (alt->>'raw_unit')::numeric; v_name := alt->>'name'; v_pid := alt->>'product_id';
    END IF;
    v_sub := v_sub + round(v_raw * (src->>'quantity')::numeric, 2) + (src->>'own_extras')::numeric;
    IF src->>'area_id' IS NOT NULL THEN kept_areas := kept_areas || (src->>'area_id'); END IF;
    out := out || jsonb_build_array(jsonb_build_object('item_id', src->'item_id', 'product_id', v_pid, 'name', v_name,
      'original_name', src->>'name', 'swapped', alt IS NOT NULL, 'area_name', src->'area_name', 'quantity', (src->>'quantity')::numeric,
      'raw_unit', v_raw, 'unit_price', round(v_raw + (src->>'install_per_unit')::numeric, 2),
      'line_total', round((v_raw + (src->>'install_per_unit')::numeric) * (src->>'quantity')::numeric, 2), 'source', 'original'));
  END LOOP;
  IF jsonb_array_length(out) = 0 THEN RAISE EXCEPTION 'Keep at least one unit.'; END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(pr->'shared_by_area') LOOP
    IF (a->>'area_id') = ANY(kept_areas) THEN v_sub := v_sub + (a->>'amount')::numeric; END IF;
  END LOOP;
  v_sub := round(v_sub + COALESCE((pr->>'job_shared')::numeric,0), 2);
  v_disc := LEAST(v_sub, round(v_sub * (pr->>'discount_pct')::numeric / 100 + (pr->>'discount_fixed')::numeric, 2));
  v_vat := round((v_sub - v_disc) * (pr->>'vat_rate')::numeric, 2);
  RETURN jsonb_build_object('lines', out, 'subtotal', v_sub, 'discount', v_disc, 'vat', v_vat, 'total', v_sub - v_disc + v_vat);
END $function$;

CREATE OR REPLACE FUNCTION public.submit_client_revision(p_token uuid, p_lines jsonb, p_note text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q public.quotes%ROWTYPE; t jsonb; v_id uuid;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE public_token = p_token AND status IN ('sent','viewed');
  IF q.id IS NULL THEN RAISE EXCEPTION 'This quote can no longer be changed online.'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 40 THEN
    RAISE EXCEPTION 'Keep at least one unit.'; END IF;
  IF (SELECT count(*) FROM public.quote_client_revisions WHERE quote_id = q.id AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Too many changes today. Please call us.'; END IF;
  t := public.qcr_revision_totals(public.qcr_pricing(q.id), p_lines);
  UPDATE public.quote_client_revisions SET status = 'withdrawn' WHERE quote_id = q.id AND status = 'pending';
  INSERT INTO public.quote_client_revisions (quote_id, company_id, lines, subtotal, discount_amount, vat_amount, total, original_total, client_note, contact_name)
  VALUES (q.id, q.company_id, t->'lines', (t->>'subtotal')::numeric, (t->>'discount')::numeric, (t->>'vat')::numeric, (t->>'total')::numeric, q.total,
    NULLIF(left(btrim(COALESCE(p_note,'')),1000),''), NULLIF(left(btrim(COALESCE(p_name,'')),120),''))
  RETURNING id INTO v_id;
  PERFORM public.qa_notify_rep_and_admins(q.id, 'quote_client_revision',
    'Client revised ' || COALESCE(q.quote_number,'quote') || ' — approve or reject',
    COALESCE(q.customer_name,'Client') || ' changed the units: R ' || to_char(q.total,'FM999G999G990D00') || ' → R ' || to_char((t->>'total')::numeric,'FM999G999G990D00') || '. Open the quote to approve or reject.');
  RETURN jsonb_build_object('id', v_id, 'total', t->'total', 'subtotal', t->'subtotal', 'vat', t->'vat', 'discount', t->'discount');
END $function$;

CREATE OR REPLACE FUNCTION public.decide_client_revision(p_revision_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.quote_client_revisions%ROWTYPE; q public.quotes%ROWTYPE; l jsonb; i int := 0; inv record; v_frac numeric;
  v_isub numeric; v_ivat numeric; v_itot numeric; v_inv_note text := 'none'; pr jsonb; v_keep uuid[]; v_gone uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin')
      OR (public.has_role(auth.uid(),'dispatcher') AND COALESCE((SELECT dispatch_role FROM public.profiles WHERE id = auth.uid()),'') <> 'sales')) THEN
    RAISE EXCEPTION 'Only management can approve client changes' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.quote_client_revisions WHERE id = p_revision_id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'This request was already handled.'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = r.quote_id FOR UPDATE;
  IF q.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Not your company''s quote' USING ERRCODE = '42501'; END IF;

  IF NOT p_approve THEN
    UPDATE public.quote_client_revisions SET status='rejected', decided_at=now(), decided_by=auth.uid(), decision_note=NULLIF(btrim(COALESCE(p_note,'')),'') WHERE id = r.id;
    PERFORM public.qa_notify_rep_and_admins(q.id, 'quote_client_revision_rejected', 'Client changes rejected on ' || COALESCE(q.quote_number,''), 'The original quote stays live.');
    RETURN jsonb_build_object('status','rejected');
  END IF;
  IF q.status NOT IN ('sent','viewed') THEN RAISE EXCEPTION 'Quote is %, cannot apply changes', q.status; END IF;

  UPDATE public.quote_client_revisions SET
    original_items = (SELECT COALESCE(jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order), '[]'::jsonb) FROM public.quote_items qi WHERE qi.quote_id = q.id),
    original_totals = jsonb_build_object('subtotal', q.subtotal, 'vat_amount', q.vat_amount, 'total', q.total, 'labour_included', q.labour_included)
  WHERE id = r.id;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.lines) e WHERE NOT (e ? 'raw_unit')) THEN
    DELETE FROM public.quote_items WHERE quote_id = q.id AND parent_item_id IS NOT NULL;
    DELETE FROM public.quote_items WHERE quote_id = q.id;
    FOR l IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
      i := i + 1;
      INSERT INTO public.quote_items (quote_id, item_name, description, unit_price, quantity, total_price, product_id, item_type, sort_order, area_id, source, metadata)
      VALUES (q.id, l->>'name', 'Supplied & installed (labour included)', (l->>'unit_price')::numeric, (l->>'quantity')::numeric, (l->>'line_total')::numeric,
        NULLIF(l->>'product_id','')::uuid, 'product', i,
        (SELECT (oi->>'area_id')::uuid FROM jsonb_array_elements((SELECT original_items FROM public.quote_client_revisions WHERE id=r.id)) oi WHERE oi->>'id' = l->>'item_id' LIMIT 1),
        'client_revision', jsonb_build_object('client_revision_id', r.id, 'labour_included', true));
    END LOOP;
    UPDATE public.quotes SET labour_included = true WHERE id = q.id;
  ELSE
    pr := public.qcr_pricing(q.id);
    SELECT array_agg((e->>'item_id')::uuid) INTO v_keep FROM jsonb_array_elements(r.lines) e;
    SELECT array_agg((e->>'item_id')::uuid) INTO v_gone FROM jsonb_array_elements(pr->'lines') e WHERE NOT ((e->>'item_id')::uuid = ANY(v_keep));
    IF v_gone IS NOT NULL THEN
      DELETE FROM public.quote_items WHERE quote_id = q.id AND (id = ANY(v_gone) OR parent_item_id = ANY(v_gone)
        OR NULLIF(metadata->'install'->>'unit_item_id','')::uuid = ANY(v_gone));
      DELETE FROM public.quote_items qi WHERE qi.quote_id = q.id AND qi.area_id IN (
          SELECT (e->>'area_id')::uuid FROM jsonb_array_elements(pr->'lines') e WHERE (e->>'item_id')::uuid = ANY(v_gone) AND e->>'area_id' IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM public.quote_items k WHERE k.quote_id = q.id AND k.area_id = qi.area_id AND k.id = ANY(v_keep));
      DELETE FROM public.quote_areas qa WHERE qa.quote_id = q.id AND NOT EXISTS (SELECT 1 FROM public.quote_items k WHERE k.area_id = qa.id);
    END IF;
    FOR l IN SELECT value FROM jsonb_array_elements(r.lines) WHERE (value->>'swapped')::boolean LOOP
      UPDATE public.quote_items SET product_id = (l->>'product_id')::uuid, item_name = l->>'name', description = NULL,
        unit_price = (l->>'raw_unit')::numeric, total_price = round((l->>'raw_unit')::numeric * quantity, 2),
        metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('client_revision_id', r.id, 'swapped_from', l->>'original_name')
      WHERE id = (l->>'item_id')::uuid AND quote_id = q.id;
    END LOOP;
  END IF;
  UPDATE public.quotes SET subtotal = r.subtotal, vat_amount = r.vat_amount, total = r.total,
    discount_type = CASE WHEN r.discount_amount > 0 THEN 'fixed' ELSE discount_type END,
    discount_value = CASE WHEN r.discount_amount > 0 THEN r.discount_amount ELSE discount_value END,
    updated_at = now() WHERE id = q.id;

  FOR inv IN SELECT * FROM public.invoices WHERE quote_id = q.id AND paid_date IS NULL AND status IN ('draft','sent') AND notes ILIKE 'DEPOSIT%' LOOP
    v_frac := CASE WHEN COALESCE(q.total,0) > 0 THEN inv.grand_total / q.total ELSE 0.7 END;
    v_isub := round((r.subtotal - r.discount_amount) * v_frac, 2); v_ivat := round(r.vat_amount * v_frac, 2); v_itot := round(r.total * v_frac, 2);
    UPDATE public.invoices SET subtotal = v_isub, tax_amount = v_ivat, grand_total = v_itot,
      line_items = CASE WHEN jsonb_typeof(line_items)='array' AND jsonb_array_length(line_items)>0 THEN jsonb_set(jsonb_set(line_items, '{0,rate}', to_jsonb(v_isub)), '{0,amount}', to_jsonb(v_isub)) ELSE line_items END, updated_at = now() WHERE id = inv.id;
    UPDATE public.invoice_items SET unit_price = v_isub, amount = v_isub WHERE invoice_id = inv.id;
    v_inv_note := inv.invoice_number || ' -> ' || v_itot;
  END LOOP;

  UPDATE public.quote_client_revisions SET status='approved', decided_at=now(), decided_by=auth.uid(), decision_note=NULLIF(btrim(COALESCE(p_note,'')),'') WHERE id = r.id;
  PERFORM public.qa_notify_rep_and_admins(q.id, 'quote_client_revision_approved', 'Client changes approved on ' || COALESCE(q.quote_number,''),
    'New total R ' || to_char(r.total,'FM999G999G990D00') || ' is now the live quote.');
  RETURN jsonb_build_object('status','approved','total', r.total, 'deposit', v_inv_note);
END $function$;