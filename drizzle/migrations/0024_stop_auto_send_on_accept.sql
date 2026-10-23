-- Johan 23 Oct 17:15 SAST: no invoice email at the moment a quote is accepted (client or staff).
-- The deposit invoice is still created as a DRAFT by on_quote_accepted -> create_deposit_invoice_for_quote,
-- and the rep/admins still get the 'invoice_ready_to_send' notification ("Nothing has been sent yet").
-- Sending stays manual (SendInvoiceEmailButton) until the approval + 15-min auto-send flow ships.
-- The function auto_send_deposit_invoice() is kept (unused) for rollback; see rollback in the release notes.
-- Idempotent: safe to run more than once.
DROP TRIGGER IF EXISTS trg_auto_send_deposit_invoice ON public.invoices;
