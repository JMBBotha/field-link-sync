CREATE OR REPLACE FUNCTION public.auto_send_deposit_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text; v_email text; v_total numeric;
BEGIN
  SELECT i.status, NULLIF(btrim(i.customer_email), ''), COALESCE(i.grand_total, 0)
    INTO v_status, v_email, v_total
    FROM public.invoices i WHERE i.id = NEW.id AND i.sent_at IS NULL;
  IF v_status IS DISTINCT FROM 'draft' OR v_email IS NULL OR v_total <= 0 THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = NEW.quote_id AND q.status = 'accepted') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_items it WHERE it.invoice_id = NEW.id AND COALESCE(it.quantity,0) > 0 AND COALESCE(it.unit_price,0) <= 0) THEN RETURN NULL; END IF;
  UPDATE public.invoices SET status = 'sent', sent_at = now(), sent_method = 'email', updated_at = now()
   WHERE id = NEW.id AND status = 'draft' AND sent_at IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.auto_send_deposit_invoice() FROM PUBLIC, anon, authenticated;