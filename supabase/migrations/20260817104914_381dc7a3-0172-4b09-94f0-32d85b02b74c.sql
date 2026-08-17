-- 1. create_quote_version
CREATE OR REPLACE FUNCTION public.create_quote_version(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote        public.quotes%ROWTYPE;
  v_next         integer;
  v_new_id       uuid;
  v_source       uuid;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote % not found', p_quote_id;
  END IF;

  IF v_quote.company_id IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised for this quote';
  END IF;

  IF v_quote.status = 'accepted' OR v_quote.accepted_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quote has been accepted and can no longer receive new versions';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
  FROM public.quote_versions WHERE quote_id = p_quote_id;

  INSERT INTO public.quote_versions (
    quote_id, version_number, total_ex_vat, total_incl_vat,
    notes, terms, valid_until, created_by
  ) VALUES (
    p_quote_id, v_next,
    COALESCE(v_quote.subtotal, 0), COALESCE(v_quote.total, 0),
    v_quote.notes, v_quote.terms_text, v_quote.valid_until, auth.uid()
  ) RETURNING id INTO v_new_id;

  -- Copy line items: from the current version, else legacy items on the quote itself
  v_source := v_quote.current_version_id;

  IF v_source IS NOT NULL THEN
    INSERT INTO public.quote_line_items (
      quote_id, quote_version_id, service_id, description,
      quantity, unit, unit_price, total, sort_order
    )
    SELECT p_quote_id, v_new_id, service_id, description,
           quantity, unit, unit_price, total, sort_order
    FROM public.quote_line_items
    WHERE quote_version_id = v_source
    ORDER BY sort_order;
  ELSE
    INSERT INTO public.quote_line_items (
      quote_id, quote_version_id, service_id, description,
      quantity, unit, unit_price, total, sort_order
    )
    SELECT p_quote_id, v_new_id, service_id, description,
           quantity, unit, unit_price, total, sort_order
    FROM public.quote_line_items
    WHERE quote_id = p_quote_id AND quote_version_id IS NULL
    ORDER BY sort_order;
  END IF;

  UPDATE public.quotes
     SET current_version_id = v_new_id,
         updated_at = now()
   WHERE id = p_quote_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_quote_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote_version(uuid) TO authenticated, service_role;

-- 2. accept_quote
CREATE OR REPLACE FUNCTION public.accept_quote(p_quote_id uuid, p_version_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote % not found', p_quote_id;
  END IF;

  IF v_company IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised for this quote';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.quote_versions
    WHERE id = p_version_id AND quote_id = p_quote_id
  ) THEN
    RAISE EXCEPTION 'Version % does not belong to quote %', p_version_id, p_quote_id;
  END IF;

  UPDATE public.quotes
     SET accepted_version_id = p_version_id,
         current_version_id  = p_version_id,
         accepted_at         = now(),
         status              = 'accepted',
         updated_at          = now()
   WHERE id = p_quote_id;

  RETURN p_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_quote(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_quote(uuid, uuid) TO authenticated, service_role;

-- 3. create_change_order
CREATE OR REPLACE FUNCTION public.create_change_order(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company  uuid;
  v_accepted uuid;
  v_new_id   uuid;
BEGIN
  SELECT company_id, accepted_version_id INTO v_company, v_accepted
  FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote % not found', p_quote_id;
  END IF;

  IF v_company IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised for this quote';
  END IF;

  IF v_accepted IS NULL THEN
    RAISE EXCEPTION 'Quote has no accepted version — accept a quote before raising a change order';
  END IF;

  INSERT INTO public.change_orders (
    quote_id, accepted_quote_version_id, status, owner_id, created_by
  ) VALUES (
    p_quote_id, v_accepted, 'draft', auth.uid(), auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_change_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_change_order(uuid) TO authenticated, service_role;