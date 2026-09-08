CREATE TRIGGER trg_invoices_sent_email
  AFTER UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent')
  EXECUTE FUNCTION public.notify_document_sent();