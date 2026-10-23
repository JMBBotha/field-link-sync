CREATE OR REPLACE FUNCTION public.auto_send_deposit_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text; v_email text;
BEGIN
  -- Runs at commit (deferred) so the invoice lines already exist.
  SELECT status, sent_at IS NULL AND customer_email INTO v_status, v_email
    FROM public.invoices WHERE id = NEW.id;
  SELECT i.status, NULLIF(btrim(i.customer_email), '') INTO v_status, v_email
    FROM public.invoices i WHERE i.id = NEW.id AND i.sent_at IS NULL;
  IF v_status IS DISTINCT FROM 'draft' OR v_email IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = NEW.quote_id AND q.status = 'accepted') THEN RETURN NULL; END IF;
  IF COALESCE((SELECT grand_total FROM public.invoices WHERE id = NEW.id), 0) <= 0 THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_items it WHERE it.invoice_id = NEW.id AND COALESCE(it.total, 0) <= 0 AND COALESCE(it.quantity,0) > 0) THEN RETURN NULL; END IF;
  -- draft -> sent fires trg_invoices_sent_email exactly once; sent_at guards any replay.
  UPDATE public.invoices SET status = 'sent', sent_at = now(), sent_method = 'email', updated_at = now()
   WHERE id = NEW.id AND status = 'draft' AND sent_at IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.auto_send_deposit_invoice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_auto_send_deposit_invoice ON public.invoices;
CREATE CONSTRAINT TRIGGER trg_auto_send_deposit_invoice AFTER INSERT ON public.invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.quote_id IS NOT NULL)
  EXECUTE FUNCTION public.auto_send_deposit_invoice();