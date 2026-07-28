ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS superseded_by uuid NULL REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_status_idx ON public.quotes (status);
CREATE INDEX IF NOT EXISTS quotes_superseded_by_idx ON public.quotes (superseded_by);