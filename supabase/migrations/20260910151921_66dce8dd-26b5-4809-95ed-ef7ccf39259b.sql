CREATE OR REPLACE FUNCTION public.recalc_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid;
  v_total numeric;
  v_paid numeric;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT grand_total INTO v_total FROM public.invoices WHERE id = v_invoice_id;
  IF v_total IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments
  WHERE invoice_id = v_invoice_id
    AND status IN ('paid', 'succeeded');

  UPDATE public.invoices
  SET status = CASE
        WHEN v_paid + 0.005 >= v_total AND v_total > 0 THEN 'paid'
        WHEN v_paid > 0 THEN 'partially_paid'
        WHEN status IN ('paid', 'partially_paid') THEN 'sent'
        ELSE status
      END,
      paid_date = CASE WHEN v_paid + 0.005 >= v_total AND v_total > 0 THEN COALESCE(paid_date, CURRENT_DATE) ELSE NULL END,
      updated_at = now()
  WHERE id = v_invoice_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_amount_paid(p_invoice_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.payments
  WHERE invoice_id = p_invoice_id
    AND status IN ('paid', 'succeeded');
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_payment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT company_id INTO v_company_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_company_id IS NOT NULL
     AND v_company_id IS DISTINCT FROM public.get_user_company_id(auth.uid())
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorised for this invoice';
  END IF;

  INSERT INTO public.payments (
    invoice_id, amount, method, reference, payment_date,
    gateway, status, company_id, created_by
  ) VALUES (
    p_invoice_id, p_amount, p_method, p_reference,
    COALESCE(p_payment_date, CURRENT_DATE)::timestamptz,
    'manual', 'paid', v_company_id, auth.uid()
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$$;