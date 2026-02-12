
-- Add original_cost_excl_vat to supplier_products for brand discount revert
ALTER TABLE public.supplier_products
ADD COLUMN IF NOT EXISTS original_cost_excl_vat numeric NULL;

-- Create brand_discounts table
CREATE TABLE IF NOT EXISTS public.brand_discounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand text NOT NULL UNIQUE,
  discount_percentage numeric NOT NULL DEFAULT 0,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.brand_discounts ENABLE ROW LEVEL SECURITY;

-- RLS policies for brand_discounts
CREATE POLICY "Admins can manage brand discounts"
  ON public.brand_discounts
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view brand discounts"
  ON public.brand_discounts
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
