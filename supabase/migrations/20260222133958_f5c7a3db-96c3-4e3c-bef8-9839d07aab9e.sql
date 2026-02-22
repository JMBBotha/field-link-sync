-- Add missing columns to supplier_products (no renames, no drops)
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS kw numeric;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS phase text CHECK (phase IN ('single', 'three'));
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS pipe_liquid text;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS pipe_gas text;
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS markup_percent numeric DEFAULT 0;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_supplier_products_phase ON public.supplier_products(phase);
CREATE INDEX IF NOT EXISTS idx_supplier_products_kw ON public.supplier_products(kw);