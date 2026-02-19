
-- Create quote_items table for saving items from visual catalog
CREATE TABLE public.quote_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  item_number TEXT,
  description TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 1,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'catalog',
  supplier TEXT,
  product_id UUID REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

-- Policies: users can manage their own quote items via quote ownership
CREATE POLICY "Users can view their quote items"
  ON public.quote_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quotes
      WHERE quotes.id = quote_items.quote_id
        AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "Users can insert their quote items"
  ON public.quote_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quotes
      WHERE quotes.id = quote_items.quote_id
        AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "Users can update their quote items"
  ON public.quote_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM quotes
      WHERE quotes.id = quote_items.quote_id
        AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "Users can delete their quote items"
  ON public.quote_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM quotes
      WHERE quotes.id = quote_items.quote_id
        AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- Allow standalone items (no quote_id) for quick-add from visual catalog
CREATE POLICY "Authenticated users can manage standalone quote items"
  ON public.quote_items FOR ALL
  USING (auth.uid() IS NOT NULL AND quote_id IS NULL)
  WITH CHECK (auth.uid() IS NOT NULL AND quote_id IS NULL);

-- Trigger for updated_at
CREATE TRIGGER update_quote_items_updated_at
  BEFORE UPDATE ON public.quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
