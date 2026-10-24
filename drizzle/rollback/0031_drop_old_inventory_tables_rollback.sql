-- Rollback 0031: recreate the old inventory tables exactly as they were (empty).
CREATE TABLE public.inventory_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL, sku text UNIQUE, category text,
  quantity_in_stock integer NOT NULL DEFAULT 0, min_stock_level integer NOT NULL DEFAULT 5,
  unit_cost numeric(10,2) NOT NULL DEFAULT 0, supplier text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Master catalogue delete" ON public.inventory_items FOR DELETE TO authenticated USING (can_write_master_catalog(auth.uid()));
CREATE POLICY "Master catalogue insert" ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (can_write_master_catalog(auth.uid()));
CREATE POLICY "Master catalogue read" ON public.inventory_items FOR SELECT TO authenticated USING (can_read_master_catalog(auth.uid()));
CREATE POLICY "Master catalogue update" ON public.inventory_items FOR UPDATE TO authenticated USING (can_write_master_catalog(auth.uid())) WITH CHECK (can_write_master_catalog(auth.uid()));
CREATE POLICY "tech_lockdown_select" ON public.inventory_items AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT is_field_tech_only(auth.uid())));

CREATE TABLE public.inventory_stock (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL UNIQUE REFERENCES public.supplier_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  stock_mode text NOT NULL DEFAULT 'order_as_needed' CHECK (stock_mode = ANY (ARRAY['order_as_needed','stock_sensitive'])));
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_inventory_stock_updated_at BEFORE UPDATE ON public.inventory_stock FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE POLICY "Admins can manage inventory stock" ON public.inventory_stock FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can view inventory stock" ON public.inventory_stock FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Field agents can insert inventory stock" ON public.inventory_stock FOR INSERT WITH CHECK (has_role(auth.uid(), 'field_agent'::app_role));
CREATE POLICY "Field agents can update inventory stock" ON public.inventory_stock FOR UPDATE USING (has_role(auth.uid(), 'field_agent'::app_role));

CREATE TABLE public.inventory_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_id uuid NOT NULL REFERENCES public.inventory_stock(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_quantity integer NOT NULL, new_quantity integer NOT NULL, reason text,
  changed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage adjustments" ON public.inventory_adjustments FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can view adjustments" ON public.inventory_adjustments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Field agents can insert adjustments" ON public.inventory_adjustments FOR INSERT WITH CHECK (has_role(auth.uid(), 'field_agent'::app_role));
-- App code removed in the same PR must also be restored (git revert of the 0031 merge commit).
