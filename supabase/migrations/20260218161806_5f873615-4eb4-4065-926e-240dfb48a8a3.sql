
CREATE TABLE public.dismissed_pdf_regions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dismiss_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dismissed_pdf_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view dismissed regions"
ON public.dismissed_pdf_regions FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert dismissed regions"
ON public.dismissed_pdf_regions FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete dismissed regions"
ON public.dismissed_pdf_regions FOR DELETE
USING (auth.uid() IS NOT NULL);
