-- Client self-adjusting quote with management approval (Johan 2026-10-13 12:09, queued after accept flow).
-- Additive only. Rollback: docs/db-releases/2026-10-13_client_quote_revisions_rollback.sql
CREATE TABLE IF NOT EXISTS public.quote_client_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  company_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  lines jsonb NOT NULL,            -- [{item_id|null, product_id|null, name, quantity, unit_price (installed, excl VAT), line_total, source}]
  subtotal numeric NOT NULL, discount_amount numeric NOT NULL DEFAULT 0, vat_amount numeric NOT NULL, total numeric NOT NULL,
  original_total numeric,
  client_note text, contact_name text,
  original_items jsonb,            -- snapshot of the quote's lines at approval (original kept for restore)
  original_totals jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by uuid, decision_note text
);
CREATE INDEX IF NOT EXISTS idx_qcrev_quote ON public.quote_client_revisions(quote_id, status);
ALTER TABLE public.quote_client_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qcrev_select_company ON public.quote_client_revisions;
CREATE POLICY qcrev_select_company ON public.quote_client_revisions FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id());

CREATE OR REPLACE FUNCTION public.qcr_is_unit(p_name text, p_type text, p_has_product boolean, p_btu integer, p_category text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT (COALESCE(p_name,'') ~* '(install|labou?r|\mkit\M|bracket|pipe|trunk|consumable|elbow|cable|drain|pump\M|travel|callout|call-out|commission)')
     AND COALESCE(p_category,'') !~* 'consumable|kit'
     AND COALESCE(p_type,'') !~* '^(labour|service|installation kit|consumables)$'
     AND ( (p_has_product AND p_btu IS NOT NULL)
        OR COALESCE(p_type,'') ~* 'air conditioning'
        OR COALESCE(p_name,'') ~* '(\d+\s*k\s*btu|\mbtu\M|\d+\s*k\M.*(inv|wall|split)|inverter|\minv\M|cassette|midwall|mid-wall|wall mounted|ducted|under ceiling|floor standing|heat pump)')
$$;

-- Installed per-unit prices: each unit line carries its share of the quote's other lines (labour, kits, materials) by price.
CREATE OR REPLACE FUNCTION public.qcr_pricing(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q public.quotes%ROWTYPE; v_u numeric := 0; v_o numeric := 0; v_ratio numeric; v_lines jsonb; v_cat jsonb;
  v_rate numeric; v_hours numeric; v_disc_pct numeric := 0;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  WITH it AS (
    SELECT qi.*, sp.btu_rating, sp.capacity_btu, sp.category,
      public.qcr_is_unit(qi.item_name, qi.item_type, qi.product_id IS NOT NULL, COALESCE(sp.btu_rating, sp.capacity_btu), sp.category) AS is_unit
    FROM public.quote_items qi LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
    WHERE qi.quote_id = p_quote_id AND qi.parent_item_id IS NULL)
  SELECT COALESCE(sum(COALESCE(total_price, quantity*unit_price)) FILTER (WHERE is_unit),0),
         COALESCE(sum(COALESCE(total_price, quantity*unit_price)) FILTER (WHERE NOT is_unit),0)
    INTO v_u, v_o FROM it;
  v_ratio := CASE WHEN v_u > 0 THEN v_o / v_u ELSE 0 END;
  SELECT COALESCE(default_hourly_rate, 0), COALESCE(default_install_labour_hours, 0) INTO v_rate, v_hours
    FROM public.company_settings WHERE company_id = q.company_id ORDER BY is_primary DESC LIMIT 1;
  IF q.discount_type IN ('percent','percentage') THEN v_disc_pct := COALESCE(q.discount_value,0); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'item_id', qi.id, 'product_id', qi.product_id, 'name', COALESCE(qi.item_name, qi.description, 'Unit'),
      'brand', sp.brand, 'btu', COALESCE(sp.btu_rating, sp.capacity_btu), 'area_name', qa.name, 'image_url', sp.image_url,
      'quantity', qi.quantity,
      'unit_price', round(COALESCE(qi.unit_price, COALESCE(qi.total_price,0)/NULLIF(qi.quantity,0)) * (1 + v_ratio), 2)
    ) ORDER BY qi.sort_order), '[]'::jsonb) INTO v_lines
  FROM public.quote_items qi LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
  LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id
  WHERE qi.quote_id = p_quote_id AND qi.parent_item_id IS NULL
    AND COALESCE(qi.quantity,0) > 0
    AND public.qcr_is_unit(qi.item_name, qi.item_type, qi.product_id IS NOT NULL, COALESCE(sp.btu_rating, sp.capacity_btu), sp.category);

  -- Catalogue: active, priced AC units. Added units carry the same labour/material share; no share available -> default install hours x rate.
  SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'btu')::int NULLS LAST, c->>'name'), '[]'::jsonb) INTO v_cat FROM (
    SELECT jsonb_build_object('product_id', sp.id, 'name', COALESCE(sp.short_name, sp.name, sp.description, sp.product_code),
      'brand', sp.brand, 'btu', COALESCE(sp.btu_rating, sp.capacity_btu), 'category', sp.category, 'image_url', sp.image_url,
      'unit_price', round(CASE WHEN v_ratio > 0 THEN sp.selling_price * (1 + v_ratio) ELSE sp.selling_price + v_rate * v_hours END, 2)) c
    FROM public.supplier_products sp
    WHERE sp.is_active AND NOT COALESCE(sp.archived,false) AND NOT COALESCE(sp.is_price_on_request,false)
      AND sp.selling_price > 0 AND COALESCE(sp.btu_rating, sp.capacity_btu) IS NOT NULL
      AND COALESCE(sp.category,'') NOT ILIKE '%consumable%' AND COALESCE(sp.product_code,'') NOT ILIKE '%~hist%'
    LIMIT 600) x;

  RETURN jsonb_build_object('lines', v_lines, 'catalogue', v_cat, 'ratio', v_ratio,
    'discount_pct', v_disc_pct, 'discount_fixed', CASE WHEN v_disc_pct = 0 THEN COALESCE(q.discount_value,0) ELSE 0 END,
    'vat_rate', CASE WHEN COALESCE(q.vat_rate,0.15) > 1 THEN q.vat_rate/100 ELSE COALESCE(q.vat_rate,0.15) END,
    'original_total', q.total);
END $$;
REVOKE ALL ON FUNCTION public.qcr_pricing(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_quote_adjust_data(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q public.quotes%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE public_token = p_token AND status IN ('sent','viewed');
  IF q.id IS NULL THEN RETURN NULL; END IF;
  v := public.qcr_pricing(q.id);
  RETURN v || jsonb_build_object('pending', (SELECT jsonb_build_object('id', r.id, 'total', r.total, 'created_at', r.created_at, 'lines', r.lines)
      FROM public.quote_client_revisions r WHERE r.quote_id = q.id AND r.status = 'pending' ORDER BY r.created_at DESC LIMIT 1),
    'last_decision', (SELECT jsonb_build_object('status', r.status, 'decided_at', r.decided_at, 'note', r.decision_note)
      FROM public.quote_client_revisions r WHERE r.quote_id = q.id AND r.status IN ('approved','rejected') ORDER BY r.decided_at DESC LIMIT 1));
END $$;
GRANT EXECUTE ON FUNCTION public.public_quote_adjust_data(uuid) TO anon, authenticated;

-- p_lines: [{"item_id": uuid} | {"product_id": uuid}, "quantity": n]. Prices are always recomputed here, never taken from the client.
CREATE OR REPLACE FUNCTION public.submit_client_revision(p_token uuid, p_lines jsonb, p_note text DEFAULT NULL, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q public.quotes%ROWTYPE; pr jsonb; l jsonb; src jsonb; out jsonb := '[]'::jsonb; v_qty numeric; v_sub numeric := 0;
  v_disc numeric; v_vat numeric; v_total numeric; v_id uuid;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE public_token = p_token AND status IN ('sent','viewed');
  IF q.id IS NULL THEN RAISE EXCEPTION 'This quote can no longer be changed online.'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 40 THEN
    RAISE EXCEPTION 'Keep at least one unit.'; END IF;
  IF (SELECT count(*) FROM public.quote_client_revisions WHERE quote_id = q.id AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Too many changes today. Please call us.'; END IF;
  pr := public.qcr_pricing(q.id);
  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := floor(COALESCE((l->>'quantity')::numeric, 0));
    IF v_qty < 1 OR v_qty > 50 THEN CONTINUE; END IF;
    src := NULL;
    IF l ? 'item_id' AND l->>'item_id' IS NOT NULL THEN
      SELECT e INTO src FROM jsonb_array_elements(pr->'lines') e WHERE e->>'item_id' = l->>'item_id';
    ELSIF l ? 'product_id' THEN
      SELECT e INTO src FROM jsonb_array_elements(pr->'catalogue') e WHERE e->>'product_id' = l->>'product_id';
    END IF;
    IF src IS NULL THEN RAISE EXCEPTION 'A unit is no longer available. Please refresh the page.'; END IF;
    out := out || jsonb_build_array(jsonb_build_object('item_id', src->'item_id', 'product_id', src->'product_id', 'name', src->>'name',
      'area_name', src->'area_name', 'quantity', v_qty, 'unit_price', (src->>'unit_price')::numeric,
      'line_total', round(v_qty * (src->>'unit_price')::numeric, 2), 'source', CASE WHEN src ? 'item_id' THEN 'original' ELSE 'added' END));
    v_sub := v_sub + round(v_qty * (src->>'unit_price')::numeric, 2);
  END LOOP;
  IF jsonb_array_length(out) = 0 THEN RAISE EXCEPTION 'Keep at least one unit.'; END IF;
  v_disc := round(v_sub * (pr->>'discount_pct')::numeric / 100 + (pr->>'discount_fixed')::numeric, 2);
  v_disc := LEAST(v_disc, v_sub);
  v_vat := round((v_sub - v_disc) * (pr->>'vat_rate')::numeric, 2);
  v_total := v_sub - v_disc + v_vat;
  UPDATE public.quote_client_revisions SET status = 'withdrawn' WHERE quote_id = q.id AND status = 'pending';
  INSERT INTO public.quote_client_revisions (quote_id, company_id, lines, subtotal, discount_amount, vat_amount, total, original_total, client_note, contact_name)
  VALUES (q.id, q.company_id, out, v_sub, v_disc, v_vat, v_total, q.total, NULLIF(left(btrim(COALESCE(p_note,'')),1000),''), NULLIF(left(btrim(COALESCE(p_name,'')),120),''))
  RETURNING id INTO v_id;
  PERFORM public.qa_notify_rep_and_admins(q.id, 'quote_client_revision',
    'Client revised ' || COALESCE(q.quote_number,'quote') || ' — approve or reject',
    COALESCE(q.customer_name,'Client') || ' changed the units: R ' || to_char(q.total,'FM999G999G990D00') || ' → R ' || to_char(v_total,'FM999G999G990D00') || '. Open the quote to approve or reject.');
  RETURN jsonb_build_object('id', v_id, 'total', v_total, 'subtotal', v_sub, 'vat', v_vat, 'discount', v_disc);
END $$;
GRANT EXECUTE ON FUNCTION public.submit_client_revision(uuid, jsonb, text, text) TO anon, authenticated;

-- Management decision (admin, or office dispatcher) of the quote's own company. One tap.
CREATE OR REPLACE FUNCTION public.decide_client_revision(p_revision_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.quote_client_revisions%ROWTYPE; q public.quotes%ROWTYPE; l jsonb; i int := 0; inv record; v_frac numeric;
  v_isub numeric; v_ivat numeric; v_itot numeric; v_inv_note text := 'none';
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

  -- Keep the original lines and totals on the revision row (restore = rollback SQL / re-insert).
  UPDATE public.quote_client_revisions SET
    original_items = (SELECT COALESCE(jsonb_agg(to_jsonb(qi) ORDER BY qi.sort_order), '[]'::jsonb) FROM public.quote_items qi WHERE qi.quote_id = q.id),
    original_totals = jsonb_build_object('subtotal', q.subtotal, 'vat_amount', q.vat_amount, 'total', q.total, 'labour_included', q.labour_included)
  WHERE id = r.id;

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
  UPDATE public.quotes SET subtotal = r.subtotal, vat_amount = r.vat_amount, total = r.total, labour_included = true,
    discount_type = CASE WHEN r.discount_amount > 0 THEN 'fixed' ELSE discount_type END,
    discount_value = CASE WHEN r.discount_amount > 0 THEN r.discount_amount ELSE discount_value END,
    updated_at = now() WHERE id = q.id;

  -- Deposit follows the new total while unpaid.
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
END $$;
REVOKE ALL ON FUNCTION public.decide_client_revision(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_client_revision(uuid, boolean, text) TO authenticated;
