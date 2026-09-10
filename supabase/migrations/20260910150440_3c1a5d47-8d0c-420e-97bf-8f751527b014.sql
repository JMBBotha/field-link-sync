-- 1) Recalc invoice status from SETTLED payments only
CREATE OR REPLACE FUNCTION public.recalc_invoice_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_total numeric;
  v_paid numeric;
  v_current_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  IF v_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT grand_total, status
    INTO v_total, v_current_status
    FROM public.invoices
   WHERE id = v_invoice_id;

  IF v_total IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only settled cash counts. Manual rows are written as 'completed';
  -- gateway rows settle as 'paid' / 'succeeded'.
  SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM public.payments
   WHERE invoice_id = v_invoice_id
     AND (
       status IN ('completed', 'succeeded', 'paid')
       OR (status IS NULL AND gateway = 'manual')
     );

  IF v_total > 0 AND v_paid + 0.005 >= v_total THEN
    UPDATE public.invoices
       SET status = 'paid',
           paid_date = COALESCE(paid_date, CURRENT_DATE),
           updated_at = now()
     WHERE id = v_invoice_id
       AND (status IS DISTINCT FROM 'paid' OR paid_date IS NULL);
  ELSIF v_paid > 0 THEN
    UPDATE public.invoices
       SET status = 'partially_paid',
           paid_date = NULL,
           updated_at = now()
     WHERE id = v_invoice_id
       AND status IS DISTINCT FROM 'partially_paid';
  ELSE
    UPDATE public.invoices
       SET status = CASE WHEN status IN ('paid', 'partially_paid') THEN 'sent' ELSE status END,
           paid_date = NULL,
           updated_at = now()
     WHERE id = v_invoice_id
       AND (status IN ('paid', 'partially_paid') OR paid_date IS NOT NULL);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 2) Also recalc when a payment's status changes (gateway settles / refunds)
DROP TRIGGER IF EXISTS trg_recalc_invoice_status_upd ON public.payments;
CREATE TRIGGER trg_recalc_invoice_status_upd
  AFTER UPDATE OF amount, invoice_id, status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_status();

-- 3) RPC: record a manual payment against an invoice (the ONLY way UI marks paid)
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
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inv RECORD;
  v_payment_id uuid;
  v_method text := lower(trim(coalesce(p_method, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF v_method = '' THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  SELECT id, company_id, agent_id, grand_total
    INTO v_inv
    FROM public.invoices
   WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR v_inv.agent_id = v_uid
    OR (v_inv.company_id IS NOT NULL AND v_inv.company_id = public.get_user_company_id(v_uid))
  ) THEN
    RAISE EXCEPTION 'Not allowed to record payments on this invoice';
  END IF;

  INSERT INTO public.payments (
    invoice_id, amount, method, reference, payment_date,
    gateway, status, environment, currency, company_id, created_by
  ) VALUES (
    p_invoice_id, round(p_amount, 2), v_method, NULLIF(trim(p_reference), ''), COALESCE(p_payment_date, CURRENT_DATE),
    'manual', 'completed', 'live', 'ZAR', v_inv.company_id, v_uid
  )
  RETURNING id INTO v_payment_id;

  -- recalc_invoice_status trigger derives partially_paid / paid from settled payments.
  RETURN v_payment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text, date) TO authenticated, service_role;