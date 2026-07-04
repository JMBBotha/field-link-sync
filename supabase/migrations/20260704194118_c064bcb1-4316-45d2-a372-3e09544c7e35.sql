
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.customer_locations(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.customer_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_location ON public.quotes (location_id);
CREATE INDEX IF NOT EXISTS idx_invoices_quote ON public.invoices (quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_location ON public.invoices (location_id);
