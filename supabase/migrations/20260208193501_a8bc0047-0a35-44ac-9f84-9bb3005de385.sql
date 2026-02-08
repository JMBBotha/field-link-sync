
-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_quotes_status_engineer ON public.quotes(status, sales_engineer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_quote_id ON public.invoices(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_status ON public.invoices(due_date, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_communication_log_lead ON public.communication_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_communication_log_customer ON public.communication_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON public.quote_line_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_job_time_entries_lead ON public.job_time_entries(lead_id, work_date);
CREATE INDEX IF NOT EXISTS idx_leads_agent_status ON public.leads(assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_public_token ON public.quotes(public_token);

-- POPIA compliance: add data_consent to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS data_consent boolean DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS data_consent_date timestamp with time zone;

-- RPC for past quote analytics (common line items by job category)
CREATE OR REPLACE FUNCTION public.past_quote_analytics(p_job_type text DEFAULT NULL)
RETURNS TABLE(description text, avg_unit_price numeric, usage_count bigint, avg_quantity numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    qli.description,
    ROUND(AVG(qli.unit_price), 2) as avg_unit_price,
    COUNT(*)::bigint as usage_count,
    ROUND(AVG(qli.quantity), 1) as avg_quantity
  FROM quote_line_items qli
  JOIN quotes q ON qli.quote_id = q.id
  WHERE q.status IN ('accepted', 'sent', 'viewed')
    AND (p_job_type IS NULL OR qli.description ILIKE '%' || p_job_type || '%')
  GROUP BY qli.description
  HAVING COUNT(*) >= 1
  ORDER BY usage_count DESC
  LIMIT 20;
END;
$$;
