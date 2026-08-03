ALTER TABLE public.vapi_calls
  ADD COLUMN IF NOT EXISTS call_category text,
  ADD COLUMN IF NOT EXISTS is_existing_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS error_reason text;

-- Clear dangling references that produced false badges
UPDATE public.vapi_calls c
SET lead_id = NULL
WHERE c.lead_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id);

UPDATE public.vapi_calls c
SET customer_id = NULL
WHERE c.customer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.customers cu WHERE cu.id = c.customer_id);

UPDATE public.vapi_calls c
SET outcome = CASE
    WHEN c.lead_id IS NOT NULL AND c.outcome IN ('lead_created','lead_enriched') THEN c.outcome
    WHEN c.lead_id IS NULL AND c.outcome IN ('lead_created','lead_enriched') THEN 'no_lead'
    ELSE c.outcome
  END;

UPDATE public.vapi_calls c
SET is_existing_client = (c.customer_id IS NOT NULL);

UPDATE public.vapi_calls c
SET call_category = CASE
    WHEN lower(coalesce(c.summary,'') || ' ' || coalesce(c.transcript,'')) ~ '(quote|quotation|estimate|pricing|price for|new unit|install)' THEN 'Quote Request'
    WHEN lower(coalesce(c.summary,'') || ' ' || coalesce(c.transcript,'')) ~ '(repair|service|not cooling|leak|maintenance|fault|broken|breakdown)' THEN 'Service Request'
    WHEN lower(coalesce(c.summary,'') || ' ' || coalesce(c.transcript,'')) ~ '(order|delivery|part|stock|invoice|payment)' THEN 'Order Update'
    ELSE 'General Inquiry'
  END
WHERE c.call_category IS NULL;

CREATE INDEX IF NOT EXISTS idx_vapi_calls_category ON public.vapi_calls (call_category);
CREATE INDEX IF NOT EXISTS idx_vapi_calls_quote_id ON public.vapi_calls (quote_id);