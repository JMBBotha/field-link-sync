CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q RECORD;
  v_pct numeric := 50;
  v_invoice_id uuid;
  v_agent uuid;
  v_deposit numeric;
  v_vat numeric;
BEGIN
  -- Idempotent: reuse existing invoice for this quote
  SELECT id INTO v_invoice_id FROM public.invoices WHERE quote_id = p_quote_id LIMIT 1;
  IF v_invoice_id IS NOT NULL THEN
    RETURN v_invoice_id;
  END IF;

  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- company_settings has no company_id column: read safely, fall back to 50
  BEGIN
    SELECT COALESCE(default_deposit_percentage, 50) INTO v_pct
    FROM public.company_settings
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_pct := 50;
  END;
  IF v_pct IS NULL THEN
    v_pct := 50;
  END IF;
  v_pct := GREATEST(0, LEAST(100, v_pct));

  -- invoices.agent_id is NOT NULL: resolve best available agent
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN
    RETURN NULL;
  END IF;

  v_deposit := ROUND(COALESCE(q.total, 0) * v_pct / 100, 2);
  v_vat := ROUND(v_deposit * 0.15, 2);

  INSERT INTO public.invoices (
    quote_id,
    lead_id,
    customer_id,
    company_id,
    agent_id,
    subtotal,
    vat_amount,
    total,
    amount_paid,
    status,
    notes
  ) VALUES (
    q.id,
    q.lead_id,
    q.customer_id,
    q.company_id,
    v_agent,
    v_deposit - v_vat,
    v_vat,
    v_deposit,
    0,
    'draft',
    'DEPOSIT (' || TRIM(TO_CHAR(v_pct, 'FM999990.##')) || '%) for quote ' || COALESCE(q.quote_number, q.id::text)
  )
  RETURNING id INTO v_invoice_id;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_deposit_invoice_for_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_deposit_invoice_for_quote(uuid) TO authenticated;