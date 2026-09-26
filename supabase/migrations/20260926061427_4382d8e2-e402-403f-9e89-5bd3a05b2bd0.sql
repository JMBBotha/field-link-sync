DROP TRIGGER IF EXISTS trg_invoices_sent_email ON public.invoices;

CREATE TRIGGER trg_invoices_sent_email
AFTER UPDATE ON public.invoices
FOR EACH ROW
WHEN (NEW.status = 'sent' AND (OLD.status IS NULL OR OLD.status IN ('draft')))
EXECUTE FUNCTION notify_document_sent();