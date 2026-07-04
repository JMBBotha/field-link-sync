-- 1. Link jobs to invoices
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_invoice_id_idx ON public.jobs(invoice_id);

-- 2. Auto status update trigger driven by payments sum
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

  SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM public.payments
   WHERE invoice_id = v_invoice_id;

  IF v_paid >= v_total AND v_total > 0 THEN
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
    -- No payments: never downgrade a manually-set 'sent'; only fix a stale 'paid'/'partially_paid'
    UPDATE public.invoices
       SET status = CASE WHEN status IN ('paid', 'partially_paid') THEN 'sent' ELSE status END,
           paid_date = NULL,
           updated_at = now()
     WHERE id = v_invoice_id
       AND (status IN ('paid', 'partially_paid') OR paid_date IS NOT NULL);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_status_ins ON public.payments;
DROP TRIGGER IF EXISTS trg_recalc_invoice_status_upd ON public.payments;
DROP TRIGGER IF EXISTS trg_recalc_invoice_status_del ON public.payments;

CREATE TRIGGER trg_recalc_invoice_status_ins
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_status();

CREATE TRIGGER trg_recalc_invoice_status_upd
AFTER UPDATE OF amount, invoice_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_status();

CREATE TRIGGER trg_recalc_invoice_status_del
AFTER DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_status();