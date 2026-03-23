
CREATE TABLE public.product_brochures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  model_match_prefixes TEXT[] NOT NULL DEFAULT '{}',
  product_family_id TEXT,
  page_count INTEGER DEFAULT 3,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_product_brochures_active ON product_brochures (is_active) WHERE is_active = true;
CREATE INDEX idx_product_brochures_prefixes ON product_brochures USING GIN (model_match_prefixes);
CREATE INDEX idx_product_brochures_brand ON product_brochures (brand);

CREATE TABLE public.quote_brochures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  brochure_id UUID NOT NULL REFERENCES product_brochures(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  is_auto_matched BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(quote_id, brochure_id)
);

CREATE INDEX idx_quote_brochures_quote ON quote_brochures (quote_id);

ALTER TABLE product_brochures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view active brochures" ON product_brochures
  FOR SELECT USING (is_active = true AND auth.role() = 'authenticated');

CREATE POLICY "Admins can manage brochures" ON product_brochures
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE quote_brochures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage quote_brochures" ON quote_brochures
  FOR ALL USING (auth.role() = 'authenticated');

INSERT INTO storage.buckets (id, name, public) VALUES ('product-brochures', 'product-brochures', true);

CREATE POLICY "Anyone can read product brochures" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-brochures');

CREATE POLICY "Authenticated users can upload product brochures" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-brochures' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete product brochures" ON storage.objects
  FOR DELETE USING (bucket_id = 'product-brochures' AND auth.role() = 'authenticated');
