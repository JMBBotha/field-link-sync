-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
DROP FUNCTION IF EXISTS public.company_history_payments(uuid);
DROP FUNCTION IF EXISTS public.company_history_customers(uuid);
DROP FUNCTION IF EXISTS public.company_history_quotes(uuid);
DROP FUNCTION IF EXISTS public.company_history_invoice(uuid, uuid);
DROP FUNCTION IF EXISTS public.company_history_invoices(uuid);
