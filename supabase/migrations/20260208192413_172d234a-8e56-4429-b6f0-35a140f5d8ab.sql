
-- Add PayFast columns to invoices
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS payfast_payment_id text,
ADD COLUMN IF NOT EXISTS payfast_url text;
