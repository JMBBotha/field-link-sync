CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q public.quotes%ROWTYPE;
  cust record;
  v_existing uuid;
  v_pct numeric;
  v_frac numeric;
  v_number text;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_rate numeric;
  v_agent uuid;
  v_id uuid;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing FROM public.invoices WHERE quote_id = q.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- company_settings has no company_id column: read safely, fall back to 50
  SELECT COALESCE(default_deposit_percentage, 50) INTO v_pct
  FROM public.company_settings
  LIMIT 1;
  v_pct := COALESCE(v_pct, 50);
  IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 50; END IF;
  v_frac := v_pct / 100.0;

  v_subtotal := ROUND(COALESCE(q.subtotal, 0) * v_frac, 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0) * v_frac, 2);
  v_total := ROUND(COALESCE(q.total, 0) * v_frac, 2);
  -- quotes store the rate as a fraction (0.15); legacy invoices store a percentage (15)
  v_rate := COALESCE(q.vat_rate, 0.15);
  IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;

  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;

  -- invoices.agent_id is NOT NULL: resolve best available agent
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN
    RETURN NULL;
  END IF;

  v_number := public.generate_invoice_number();

  INSERT INTO public.invoices (
    quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total,
    due_date, status, line_items, company_id, notes
  ) VALUES (
    q.id, q.lead_id, v_agent, q.customer_id,
    COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_subtotal, v_rate, v_vat, v_total,
    CURRENT_DATE + 30, 'draft',
    jsonb_build_array(jsonb_build_object(
      'description', 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
      'quantity', 1,
      'rate', v_subtotal,
      'amount', v_subtotal
    )),
    q.company_id,
    'DEPOSIT — ' || ROUND(v_pct)::text || '% of quote ' || COALESCE(q.quote_number, '') || '. Balance invoiced on completion.'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id,
    'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
    1, v_subtotal, v_subtotal);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_deposit_invoice_for_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_deposit_invoice_for_quote(uuid) TO authenticated;