ALTER TABLE public.bundle_items ADD COLUMN IF NOT EXISTS model_number text;
ALTER TABLE public.bundle_items ADD COLUMN IF NOT EXISTS match_status text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bundle_items_match_status_chk') THEN
    ALTER TABLE public.bundle_items ADD CONSTRAINT bundle_items_match_status_chk
      CHECK (match_status IS NULL OR match_status IN ('found','not_found','remapped'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bundle_items_model_lower_idx ON public.bundle_items (lower(model_number));