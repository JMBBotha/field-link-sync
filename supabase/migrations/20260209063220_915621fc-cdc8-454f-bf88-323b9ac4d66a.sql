
-- Add visual proposal columns to quote_templates
ALTER TABLE public.quote_templates
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sections jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_text text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- Add visual sections storage to quotes themselves
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS visual_sections jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_text text,
  ADD COLUMN IF NOT EXISTS discount_type text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reference_text text;
