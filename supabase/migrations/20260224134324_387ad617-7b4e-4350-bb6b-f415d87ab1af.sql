
-- ============================================
-- 1. Create quote_areas table
-- ============================================
CREATE TABLE public.quote_areas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_quote_areas_quote_id ON public.quote_areas(quote_id);
CREATE INDEX idx_quote_areas_sort ON public.quote_areas(quote_id, sort_order);

-- RLS
ALTER TABLE public.quote_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view quote areas" ON public.quote_areas
  FOR SELECT USING (true);

CREATE POLICY "Users can insert quote areas" ON public.quote_areas
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update quote areas" ON public.quote_areas
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete quote areas" ON public.quote_areas
  FOR DELETE USING (true);

-- Updated_at trigger
CREATE TRIGGER update_quote_areas_updated_at
  BEFORE UPDATE ON public.quote_areas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 2. Alter existing quote_items table
-- ============================================
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES public.quote_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES public.quote_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS length NUMERIC,
  ADD COLUMN IF NOT EXISTS total_price NUMERIC,
  ADD COLUMN IF NOT EXISTS item_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Indexes on new columns
CREATE INDEX IF NOT EXISTS idx_quote_items_area_id ON public.quote_items(area_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_parent ON public.quote_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_sort ON public.quote_items(quote_id, area_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON public.quote_items(quote_id);

-- ============================================
-- 3. Add customer_name to quotes if missing
-- ============================================
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- ============================================
-- 4. Enable realtime
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_areas;
