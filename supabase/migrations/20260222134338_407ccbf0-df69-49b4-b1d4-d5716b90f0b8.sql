-- Create function to mark overdue company_invoices
CREATE OR REPLACE FUNCTION public.update_overdue_invoices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.company_invoices
  SET status = 'Overdue', updated_at = now()
  WHERE status NOT IN ('Paid', 'Overdue', 'Archived')
    AND due_date IS NOT NULL
    AND due_date < CURRENT_DATE;
END;
$$;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;