
-- Suppliers table
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  website text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage suppliers" ON public.suppliers FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can view suppliers" ON public.suppliers FOR SELECT USING (auth.uid() IS NOT NULL);

-- Supplier products / catalog table
CREATE TABLE public.supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  subcategory text,
  pipe_size text,
  cost_price numeric NOT NULL DEFAULT 0,
  default_markup_percent numeric NOT NULL DEFAULT 30,
  selling_price numeric GENERATED ALWAYS AS (
    CASE WHEN cost_price > 0 THEN ROUND(cost_price * (1 + default_markup_percent / 100), 2) ELSE 0 END
  ) STORED,
  is_price_on_request boolean NOT NULL DEFAULT false,
  refrigerant_type text,
  btu_rating integer,
  unit_type text,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  quote_usage_count integer NOT NULL DEFAULT 0,
  last_quoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage supplier products" ON public.supplier_products FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can view supplier products" ON public.supplier_products FOR SELECT USING (auth.uid() IS NOT NULL);

-- Full-text search index
CREATE INDEX idx_supplier_products_search ON public.supplier_products
  USING GIN (to_tsvector('english', product_code || ' ' || description || ' ' || category || ' ' || COALESCE(subcategory, '') || ' ' || COALESCE(pipe_size, '')));

CREATE INDEX idx_supplier_products_category ON public.supplier_products(category);
CREATE INDEX idx_supplier_products_supplier ON public.supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_usage ON public.supplier_products(quote_usage_count DESC);

-- Price list uploads tracking
CREATE TABLE public.price_list_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL DEFAULT 'csv',
  products_imported integer NOT NULL DEFAULT 0,
  products_updated integer NOT NULL DEFAULT 0,
  products_skipped integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_list_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage uploads" ON public.price_list_uploads FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to increment usage count when a product is added to a quote
CREATE OR REPLACE FUNCTION public.increment_product_usage(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE supplier_products
  SET quote_usage_count = quote_usage_count + 1,
      last_quoted_at = now()
  WHERE id = p_product_id;
END;
$$;

-- Search function with usage-weighted ranking
CREATE OR REPLACE FUNCTION public.search_supplier_products(
  p_query text,
  p_category text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  supplier_id uuid,
  supplier_name text,
  product_code text,
  description text,
  category text,
  subcategory text,
  pipe_size text,
  cost_price numeric,
  default_markup_percent numeric,
  selling_price numeric,
  is_price_on_request boolean,
  btu_rating integer,
  refrigerant_type text,
  image_url text,
  quote_usage_count integer,
  last_quoted_at timestamptz,
  search_rank real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sp.id,
    sp.supplier_id,
    s.name as supplier_name,
    sp.product_code,
    sp.description,
    sp.category,
    sp.subcategory,
    sp.pipe_size,
    sp.cost_price,
    sp.default_markup_percent,
    sp.selling_price,
    sp.is_price_on_request,
    sp.btu_rating,
    sp.refrigerant_type,
    sp.image_url,
    sp.quote_usage_count,
    sp.last_quoted_at,
    CASE
      WHEN p_query IS NULL OR p_query = '' THEN 0
      ELSE ts_rank(
        to_tsvector('english', sp.product_code || ' ' || sp.description || ' ' || sp.category || ' ' || COALESCE(sp.subcategory, '') || ' ' || COALESCE(sp.pipe_size, '')),
        plainto_tsquery('english', p_query)
      )
    END as search_rank
  FROM supplier_products sp
  JOIN suppliers s ON s.id = sp.supplier_id
  WHERE sp.is_active = true
    AND (p_category IS NULL OR sp.category = p_category)
    AND (p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id)
    AND (
      p_query IS NULL OR p_query = ''
      OR to_tsvector('english', sp.product_code || ' ' || sp.description || ' ' || sp.category || ' ' || COALESCE(sp.subcategory, '') || ' ' || COALESCE(sp.pipe_size, ''))
         @@ plainto_tsquery('english', p_query)
      OR sp.product_code ILIKE '%' || p_query || '%'
      OR sp.description ILIKE '%' || p_query || '%'
    )
  ORDER BY
    sp.quote_usage_count DESC,
    search_rank DESC,
    sp.description ASC
  LIMIT p_limit;
END;
$$;
