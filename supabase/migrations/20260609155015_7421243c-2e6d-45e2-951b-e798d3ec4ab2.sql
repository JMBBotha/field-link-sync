ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lead_source text DEFAULT 'Manual';
COMMENT ON COLUMN public.customers.lead_source IS 'Where the customer came from: Manual, Facebook Lead, Website Form, WhatsApp, Phone Call, Walk-in, Referral';
CREATE INDEX IF NOT EXISTS idx_customers_lead_source ON public.customers(lead_source);