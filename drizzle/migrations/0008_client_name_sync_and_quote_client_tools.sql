-- 1. Client name edits were overwritten by first_name + last_name on every update.
CREATE OR REPLACE FUNCTION public.normalize_customer_contacts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.normalized_phone := normalize_phone(NEW.phone);
  NEW.normalized_email := lower(trim(COALESCE(NEW.email, '')));
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_name IS NOT NULL AND NULLIF(trim(COALESCE(NEW.name,'')),'') IS NULL THEN
      NEW.name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
    END IF;
  ELSIF NEW.name IS DISTINCT FROM OLD.name
        AND NEW.first_name IS NOT DISTINCT FROM OLD.first_name
        AND NEW.last_name IS NOT DISTINCT FROM OLD.last_name THEN
    -- Name edited directly: keep first/last in step with it.
    IF NULLIF(trim(COALESCE(NEW.name,'')),'') IS NOT NULL AND OLD.first_name IS NOT NULL THEN
      NEW.first_name := split_part(trim(NEW.name), ' ', 1);
      NEW.last_name := NULLIF(trim(substr(trim(NEW.name), length(split_part(trim(NEW.name), ' ', 1)) + 1)), '');
    END IF;
  ELSIF NEW.first_name IS NOT NULL AND (NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name) THEN
    NEW.name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Renaming a client refreshes only DRAFT quotes that still carried the old name.
CREATE OR REPLACE FUNCTION public.sync_draft_quote_customer_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.quotes SET customer_name = NEW.name
     WHERE customer_id = NEW.id AND status = 'draft' AND customer_name = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_draft_quote_customer_name ON public.customers;
CREATE TRIGGER trg_sync_draft_quote_customer_name AFTER UPDATE OF name ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.sync_draft_quote_customer_name();

-- 3. Change the client on a draft quote (lines and prices untouched).
CREATE OR REPLACE FUNCTION public.change_quote_client(p_quote_id uuid, p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q record; c record;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF q.status <> 'draft' THEN RAISE EXCEPTION 'Only draft quotes can change client. Duplicate this quote instead.'; END IF;
  SELECT id, name, company_id INTO c FROM public.customers WHERE id = p_customer_id;
  IF c.id IS NULL OR c.company_id IS DISTINCT FROM q.company_id THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF c.id = q.customer_id THEN RETURN; END IF;
  UPDATE public.quotes SET
    customer_id = c.id, customer_name = c.name, location_id = NULL, site_id = NULL,
    lead_id = CASE WHEN EXISTS (SELECT 1 FROM public.leads l WHERE l.id = q.lead_id AND l.customer_id = c.id) THEN q.lead_id ELSE NULL END
  WHERE id = p_quote_id;
END;
$$;

-- 4. Duplicate a quote as a fresh draft, optionally for another client.
CREATE OR REPLACE FUNCTION public.duplicate_quote(p_quote_id uuid, p_customer_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q record; c record; v_new uuid; v_area uuid; v_amap jsonb := '{}'; v_imap jsonb; r record; v_same boolean;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  SELECT id, name, company_id INTO c FROM public.customers WHERE id = COALESCE(p_customer_id, q.customer_id);
  IF c.id IS NULL OR c.company_id IS DISTINCT FROM q.company_id THEN RAISE EXCEPTION 'Client not found'; END IF;
  v_same := c.id = q.customer_id;

  INSERT INTO public.quotes (company_id, customer_id, customer_name, sales_engineer_id, owner_id, created_by, status,
    quote_number, vat_rate, notes, terms_text, discount_type, discount_value, reference_text, visual_sections,
    location_id, site_id, units_markup_percent, materials_markup_percent, labour_mode, materials_waste_percent,
    payment_plan, show_unit_cards, labour_included, client_summary)
  VALUES (q.company_id, c.id, CASE WHEN v_same THEN COALESCE(q.customer_name, c.name) ELSE c.name END,
    q.sales_engineer_id, q.owner_id, auth.uid(), 'draft',
    public.generate_quote_number(q.company_id), q.vat_rate, q.notes, q.terms_text, q.discount_type, q.discount_value,
    q.reference_text, q.visual_sections, CASE WHEN v_same THEN q.location_id END, CASE WHEN v_same THEN q.site_id END,
    q.units_markup_percent, q.materials_markup_percent, q.labour_mode, q.materials_waste_percent,
    q.payment_plan, q.show_unit_cards, q.labour_included, q.client_summary)
  RETURNING id INTO v_new;

  FOR r IN SELECT * FROM public.quote_areas WHERE quote_id = p_quote_id ORDER BY sort_order LOOP
    INSERT INTO public.quote_areas (quote_id, name, sort_order, description)
    VALUES (v_new, r.name, r.sort_order, r.description) RETURNING id INTO v_area;
    v_amap := v_amap || jsonb_build_object(r.id::text, v_area);
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(id::text, gen_random_uuid()), '{}') INTO v_imap
    FROM public.quote_items WHERE quote_id = p_quote_id;

  INSERT INTO public.quote_items (id, quote_id, item_name, item_number, description, unit_price, quantity, notes, source,
    supplier, product_id, area_id, parent_item_id, is_bundle, length, total_price, item_type, metadata, sort_order,
    unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty)
  SELECT (v_imap->>i.id::text)::uuid, v_new, i.item_name, i.item_number, i.description, i.unit_price, i.quantity, i.notes, i.source,
    i.supplier, i.product_id, (v_amap->>i.area_id::text)::uuid, (v_imap->>i.parent_item_id::text)::uuid, i.is_bundle, i.length,
    i.total_price, i.item_type,
    CASE WHEN v_imap ? COALESCE(i.metadata #>> '{install,unit_item_id}', '')
         THEN jsonb_set(i.metadata, '{install,unit_item_id}', to_jsonb(v_imap->>(i.metadata #>> '{install,unit_item_id}')))
         ELSE i.metadata END,
    i.sort_order, i.unit_type, i.price_per_unit_qty, i.price_per_unit_label, i.allows_decimal_qty, i.qty_step, i.min_qty
  FROM public.quote_items i WHERE i.quote_id = p_quote_id
  ORDER BY (i.parent_item_id IS NOT NULL), i.sort_order;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_quote_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_quote(uuid, uuid) TO authenticated;