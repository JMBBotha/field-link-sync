ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS units_markup_percent numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS materials_markup_percent numeric NOT NULL DEFAULT 100;
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS units_markup_percent numeric,
  ADD COLUMN IF NOT EXISTS materials_markup_percent numeric;