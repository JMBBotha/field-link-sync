ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS search_tags text;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS supplier_products_search_tags_trgm ON public.supplier_products USING gin (search_tags gin_trgm_ops)';
  END IF;
END $$;