ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.customer_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_location_id_idx ON public.quotes(location_id);