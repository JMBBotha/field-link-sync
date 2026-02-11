
-- Create inventory_stock table for stock quantities
CREATE TABLE public.inventory_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);

-- Create inventory_adjustments table for stock change history
CREATE TABLE public.inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id uuid NOT NULL REFERENCES public.inventory_stock(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_quantity integer NOT NULL,
  new_quantity integer NOT NULL,
  reason text,
  changed_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;

-- RLS policies for inventory_stock
CREATE POLICY "Authenticated users can view inventory stock"
  ON public.inventory_stock FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage inventory stock"
  ON public.inventory_stock FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Field agents can update inventory stock"
  ON public.inventory_stock FOR UPDATE
  USING (has_role(auth.uid(), 'field_agent'::app_role));

CREATE POLICY "Field agents can insert inventory stock"
  ON public.inventory_stock FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'field_agent'::app_role));

-- RLS policies for inventory_adjustments
CREATE POLICY "Authenticated users can view adjustments"
  ON public.inventory_adjustments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage adjustments"
  ON public.inventory_adjustments FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Field agents can insert adjustments"
  ON public.inventory_adjustments FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'field_agent'::app_role));

-- Trigger for updated_at on inventory_stock
CREATE TRIGGER update_inventory_stock_updated_at
  BEFORE UPDATE ON public.inventory_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial stock rows for all active supplier_products
INSERT INTO public.inventory_stock (product_id, quantity, low_stock_threshold)
SELECT id, 0, 3 FROM public.supplier_products WHERE is_active = true
ON CONFLICT (product_id) DO NOTHING;
