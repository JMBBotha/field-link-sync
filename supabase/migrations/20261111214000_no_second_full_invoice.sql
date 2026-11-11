-- Legacy balance-invoice path. Today's quote has one full-value invoice
-- (notes begin "Quote", the deposit is a stage on that invoice).
-- This guard returns that invoice and does not insert another one.
-- Existing invoice rows are not updated.

CREATE OR REPLACE FUNCTION public._create_balance_invoice(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes%ROWTYPE; cust record; v_existing uuid; v_cover uuid; v_billed numeric; v_bal numeric; v_frac numeric;
  v_sub numeric; v_vat numeric; v_rate numeric; v_agent uuid; v_number text; v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('balance_invoice:' || p_quote_id::text, 0));
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' OR COALESCE(q.total, 0) <= 0 THEN RETURN NULL; END IF;

  -- One live invoice already bills the whole quote. Hand that id back.
  SELECT id INTO v_cover FROM public.invoices
   WHERE quote_id = q.id AND COALESCE(status,'') NOT IN ('void','cancelled')
     AND COALESCE(grand_total, 0) + 0.01 >= COALESCE(q.total, 0)
   ORDER BY created_at LIMIT 1;
  IF v_cover IS NOT NULL THEN RETURN v_cover; END IF;

  SELECT id INTO v_existing FROM public.invoices
   WHERE quote_id = q.id AND COALESCE(status,'') NOT IN ('void','cancelled') AND COALESCE(notes,'') NOT LIKE 'DEPOSIT%' AND COALESCE(notes,'') NOT LIKE 'STAGE%'
   ORDER BY created_at LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(sum(grand_total), 0) INTO v_billed FROM public.invoices
   WHERE quote_id = q.id AND COALESCE(status,'') NOT IN ('void','cancelled');
  IF v_billed + 0.01 >= COALESCE(q.total, 0) THEN
    SELECT id INTO v_existing FROM public.invoices
     WHERE quote_id = q.id AND COALESCE(status,'') NOT IN ('void','cancelled')
     ORDER BY created_at LIMIT 1;
    RETURN v_existing;
  END IF;

  -- A genuine old deposit invoice that is still unpaid, and the job is not done.
  IF EXISTS (SELECT 1 FROM public.invoices d WHERE d.quote_id = q.id AND COALESCE(d.notes,'') LIKE 'DEPOSIT%'
               AND COALESCE(d.status,'') NOT IN ('void','cancelled','paid')
               AND COALESCE(d.grand_total, 0) + 0.01 < COALESCE(q.total, 0))
     AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.quote_id = q.id AND j.status IN ('completed','done','invoiced','closed')) THEN
    RAISE EXCEPTION 'The deposit invoice for quote % is not paid yet and the job is not done. The remaining balance is invoiced after that.', COALESCE(q.quote_number, '') USING ERRCODE = 'P0001';
  END IF;

  v_bal := ROUND(q.total - v_billed, 2);
  IF v_bal <= 0.01 THEN RETURN NULL; END IF;
  v_frac := v_bal / q.total;
  v_vat := ROUND(COALESCE(q.vat_amount, 0) * v_frac, 2);
  v_sub := v_bal - v_vat;
  v_rate := COALESCE(q.vat_rate, 0.15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN RETURN NULL; END IF;
  v_number := public.generate_invoice_number();
  INSERT INTO public.invoices (quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes)
  VALUES (q.id, COALESCE(q.lead_id, (SELECT j.lead_id FROM public.jobs j WHERE j.quote_id = q.id AND j.status <> 'cancelled' ORDER BY j.created_at DESC LIMIT 1)),
    v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_sub, v_rate, v_vat, v_bal, CURRENT_DATE + 30, 'draft',
    jsonb_build_array(jsonb_build_object('description', 'Remaining balance — quote ' || COALESCE(q.quote_number, ''),
      'quantity', 1, 'rate', v_sub, 'amount', v_sub)),
    q.company_id,
    'Remaining balance — quote ' || COALESCE(q.quote_number, '') || ': R ' || to_char(q.total, 'FM999999990.00')
      || ' less R ' || to_char(v_billed, 'FM999999990.00') || ' already invoiced.')
  RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id, 'Remaining balance — quote ' || COALESCE(q.quote_number, ''), 1, v_sub, v_sub);
  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public._create_balance_invoice(uuid) IS
  'Legacy remainder only. Returns the live invoice when that invoice, or the live invoices together, already cover the quote. Never updates an invoice that already exists.';

CREATE OR REPLACE FUNCTION public.trg_job_completed_balance_invoice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF current_setting('app.backfill', true) = '1' THEN RETURN NEW; END IF;
  -- Only an old partial deposit invoice (notes DEPOSIT/STAGE, total below the quote)
  -- can ask for a remainder. A full-value invoice, including one whose notes say Quote, does not.
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.quote_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = NEW.quote_id AND q.status = 'accepted')
     AND EXISTS (
       SELECT 1 FROM public.invoices i
       JOIN public.quotes q ON q.id = i.quote_id
       WHERE i.quote_id = NEW.quote_id
         AND COALESCE(i.status,'') NOT IN ('void','cancelled')
         AND (COALESCE(i.notes,'') LIKE 'DEPOSIT%' OR COALESCE(i.notes,'') LIKE 'STAGE%')
         AND COALESCE(i.grand_total, 0) + 0.01 < COALESCE(q.total, 0)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.invoices i
       JOIN public.quotes q ON q.id = i.quote_id
       WHERE i.quote_id = NEW.quote_id
         AND COALESCE(i.status,'') NOT IN ('void','cancelled')
         AND COALESCE(i.grand_total, 0) + 0.01 >= COALESCE(q.total, 0)
     ) THEN
    BEGIN PERFORM public._create_balance_invoice(NEW.quote_id);
    EXCEPTION WHEN others THEN RAISE WARNING 'remaining balance invoice skipped: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $function$;
