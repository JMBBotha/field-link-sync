
-- Invoice Templates table
CREATE TABLE public.invoice_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view templates"
  ON public.invoice_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert templates"
  ON public.invoice_templates FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update templates"
  ON public.invoice_templates FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete templates"
  ON public.invoice_templates FOR DELETE
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_invoice_templates_updated_at
  BEFORE UPDATE ON public.invoice_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add HVAC product classification columns to supplier_products
ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS unit_type TEXT,
  ADD COLUMN IF NOT EXISTS capacity_btu INTEGER,
  ADD COLUMN IF NOT EXISTS inverter BOOLEAN,
  ADD COLUMN IF NOT EXISTS model_range TEXT;

-- Add template_id to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.invoice_templates(id);
