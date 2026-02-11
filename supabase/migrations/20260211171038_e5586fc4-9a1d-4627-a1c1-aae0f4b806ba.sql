
-- Installation Bundles table
CREATE TABLE public.installation_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  ac_type TEXT,
  btu_rating INTEGER,
  pipe_size TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.installation_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bundles"
  ON public.installation_bundles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create bundles"
  ON public.installation_bundles FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update bundles"
  ON public.installation_bundles FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete bundles"
  ON public.installation_bundles FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Bundle Items table
CREATE TABLE public.bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES public.installation_bundles(id) ON DELETE CASCADE,
  supplier_product_id UUID NOT NULL REFERENCES public.supplier_products(id),
  quantity DECIMAL NOT NULL DEFAULT 1,
  length_metres DECIMAL,
  is_length_item BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bundle items"
  ON public.bundle_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create bundle items"
  ON public.bundle_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update bundle items"
  ON public.bundle_items FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete bundle items"
  ON public.bundle_items FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_bundle_items_bundle_id ON public.bundle_items(bundle_id);
CREATE INDEX idx_installation_bundles_active ON public.installation_bundles(is_active) WHERE is_active = true;

-- Updated_at trigger
CREATE TRIGGER update_installation_bundles_updated_at
  BEFORE UPDATE ON public.installation_bundles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
