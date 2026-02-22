
-- Backfill NULL slugs with id-based value so NOT NULL can be applied
UPDATE companies SET slug = id::text WHERE slug IS NULL;

-- Add new columns
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 15;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Make slug NOT NULL and UNIQUE (drop existing constraint first if any)
ALTER TABLE companies ALTER COLUMN slug SET NOT NULL;
ALTER TABLE companies ALTER COLUMN slug SET DEFAULT '';

-- Add unique constraint if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_slug_key') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_slug_key UNIQUE (slug);
  END IF;
END $$;

-- Add index on slug
CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);

-- Drop columns not in new spec
ALTER TABLE companies DROP COLUMN IF EXISTS email;
ALTER TABLE companies DROP COLUMN IF EXISTS phone;
ALTER TABLE companies DROP COLUMN IF EXISTS address;
ALTER TABLE companies DROP COLUMN IF EXISTS vat_number;
ALTER TABLE companies DROP COLUMN IF EXISTS vat_registered;

-- Add updated_at trigger
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
