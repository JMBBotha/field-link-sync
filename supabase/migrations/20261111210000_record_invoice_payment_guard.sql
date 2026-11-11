-- Manual payment recording: one lock per invoice, one dedupe key, no silent overpay.
-- Does not change amounts already on an invoice. Invoice status stays with
-- recalc_invoice_status, which marks paid only when settled payments cover grand_total.
-- A deposit therefore cannot mark the whole invoice paid.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_invoice_dedupe_uidx
  ON public.payments (invoice_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Same EFT reference on one invoice cannot be recorded twice. Skipped when
-- existing rows already share a reference, so this migration cannot fail a live database.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.payments
     WHERE gateway = 'manual'
       AND reference IS NOT NULL AND btrim(reference) <> ''
       AND status IN ('paid', 'succeeded', 'completed')
     GROUP BY invoice_id, lower(btrim(reference))
    HAVING count(*) > 1
  ) THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS payments_manual_reference_uidx
        ON public.payments (invoice_id, lower(btrim(reference)))
       WHERE gateway = 'manual'
         AND reference IS NOT NULL AND btrim(reference) <> ''
         AND status IN ('paid', 'succeeded', 'completed')
    $idx$;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.record_invoice_payment(uuid, numeric, text, text, date);

CREATE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_allow_overpay boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_total numeric;
  v_paid numeric;
  v_cred numeric := 0;
  v_outstanding numeric;
  v_payment_id uuid;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('record_invoice_payment:' || p_invoice_id::text, 0));

  SELECT company_id, grand_total INTO v_company_id, v_total
    FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_company_id IS NOT NULL
     AND v_company_id IS DISTINCT FROM public.get_user_company_id(auth.uid())
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorised for this invoice';
  END IF;

  -- A retry of the same click returns the payment already stored.
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_payment_id
      FROM public.payments
     WHERE invoice_id = p_invoice_id AND dedupe_key = v_key
     LIMIT 1;
    IF v_payment_id IS NOT NULL THEN
      RETURN v_payment_id;
    END IF;
  END IF;

  IF nullif(btrim(coalesce(p_reference, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.payments
        WHERE invoice_id = p_invoice_id
          AND gateway = 'manual'
          AND status IN ('paid', 'succeeded', 'completed')
          AND lower(btrim(reference)) = lower(btrim(p_reference))
     ) THEN
    RAISE EXCEPTION 'A payment with this reference is already on this invoice. It was not recorded again.'
      USING ERRCODE = 'P0001';
  END IF;

  v_paid := public.invoice_amount_paid(p_invoice_id);
  IF to_regclass('public.credit_notes') IS NOT NULL THEN
    SELECT coalesce(sum(total), 0) INTO v_cred
      FROM public.credit_notes
     WHERE invoice_id = p_invoice_id AND coalesce(status, '') <> 'void';
  END IF;
  v_outstanding := round(coalesce(v_total, 0) - coalesce(v_paid, 0) - coalesce(v_cred, 0), 2);
  IF v_outstanding < 0 THEN
    v_outstanding := 0;
  END IF;
  IF round(p_amount, 2) > v_outstanding + 0.01 AND NOT coalesce(p_allow_overpay, false) THEN
    RAISE EXCEPTION 'This payment is more than the amount still outstanding. It was not recorded.'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.payments (
      invoice_id, amount, method, reference, payment_date,
      gateway, status, company_id, created_by, dedupe_key
    ) VALUES (
      p_invoice_id, p_amount, p_method, p_reference,
      COALESCE(p_payment_date, CURRENT_DATE)::timestamptz,
      'manual', 'paid', v_company_id, auth.uid(), v_key
    )
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id
        FROM public.payments
       WHERE invoice_id = p_invoice_id AND dedupe_key = v_key
       LIMIT 1;
      IF v_payment_id IS NOT NULL THEN
        RETURN v_payment_id;
      END IF;
    END IF;
    RAISE EXCEPTION 'A payment with this reference is already on this invoice. It was not recorded again.'
      USING ERRCODE = 'P0001';
  END;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text, date, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text, date, boolean, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text, date, boolean, text) IS
  'Records a settled manual payment. Locks the invoice, rejects a repeated reference, and rejects an amount above the outstanding balance unless p_allow_overpay is true. Does not set invoice status; the payment trigger reconciles status against grand_total.';
