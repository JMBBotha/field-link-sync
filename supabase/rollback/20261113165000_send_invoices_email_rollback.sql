-- Undo 20261113165000_send_invoices_email. Emails already sent stay sent.
DROP FUNCTION IF EXISTS public.send_invoices_email(uuid[], text, text, jsonb);
