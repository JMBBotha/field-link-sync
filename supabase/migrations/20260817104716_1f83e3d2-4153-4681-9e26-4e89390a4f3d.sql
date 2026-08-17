-- 1. Extend existing quotes table (non-destructive)
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS site_id uuid,
  ADD COLUMN IF NOT EXISTS current_version_id uuid,
  ADD COLUMN IF NOT EXISTS accepted_version_id uuid,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- 2. quote_versions
CREATE TABLE public.quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  total_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  total_incl_vat numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  terms text,
  valid_until date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, version_number)
);
CREATE INDEX idx_quote_versions_quote_id ON public.quote_versions(quote_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_versions TO authenticated;
GRANT ALL ON public.quote_versions TO service_role;
ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view quote versions" ON public.quote_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_versions.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can create quote versions" ON public.quote_versions
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_versions.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can update quote versions" ON public.quote_versions
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_versions.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant admins can delete quote versions" ON public.quote_versions
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_versions.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())
      AND public.has_role(auth.uid(), 'admin'::app_role)));

-- Quote -> version pointers
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_current_version_id_fkey
    FOREIGN KEY (current_version_id) REFERENCES public.quote_versions(id) ON DELETE SET NULL,
  ADD CONSTRAINT quotes_accepted_version_id_fkey
    FOREIGN KEY (accepted_version_id) REFERENCES public.quote_versions(id) ON DELETE SET NULL;

-- 3. Existing quote_line_items gain version link
ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS quote_version_id uuid REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_quote_line_items_version_id ON public.quote_line_items(quote_version_id);

-- 4. change_orders
CREATE TABLE public.change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  accepted_quote_version_id uuid NOT NULL REFERENCES public.quote_versions(id) ON DELETE RESTRICT,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined')),
  reason text,
  total_impact_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  total_impact_incl_vat numeric(12,2) NOT NULL DEFAULT 0,
  requested_by text CHECK (requested_by IN ('client','internal','technician')),
  owner_id uuid,
  created_by uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_change_orders_quote_id ON public.change_orders(quote_id);
CREATE INDEX idx_change_orders_job_id ON public.change_orders(job_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_orders TO authenticated;
GRANT ALL ON public.change_orders TO service_role;
ALTER TABLE public.change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view change orders" ON public.change_orders
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = change_orders.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can create change orders" ON public.change_orders
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = change_orders.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can update change orders" ON public.change_orders
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = change_orders.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant admins can delete change orders" ON public.change_orders
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = change_orders.quote_id
      AND q.company_id = public.get_user_company_id(auth.uid())
      AND public.has_role(auth.uid(), 'admin'::app_role)));

CREATE TRIGGER update_change_orders_updated_at
  BEFORE UPDATE ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. change_order_line_items
CREATE TABLE public.change_order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id uuid NOT NULL REFERENCES public.change_orders(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('add','remove','modify')),
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  original_line_item_id uuid REFERENCES public.quote_line_items(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_col_items_change_order_id ON public.change_order_line_items(change_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_order_line_items TO authenticated;
GRANT ALL ON public.change_order_line_items TO service_role;
ALTER TABLE public.change_order_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view change order items" ON public.change_order_line_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.change_orders co
    JOIN public.quotes q ON q.id = co.quote_id
    WHERE co.id = change_order_line_items.change_order_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can create change order items" ON public.change_order_line_items
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.change_orders co
    JOIN public.quotes q ON q.id = co.quote_id
    WHERE co.id = change_order_line_items.change_order_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can update change order items" ON public.change_order_line_items
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.change_orders co
    JOIN public.quotes q ON q.id = co.quote_id
    WHERE co.id = change_order_line_items.change_order_id
      AND q.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Tenant users can delete change order items" ON public.change_order_line_items
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.change_orders co
    JOIN public.quotes q ON q.id = co.quote_id
    WHERE co.id = change_order_line_items.change_order_id
      AND q.company_id = public.get_user_company_id(auth.uid())));