-- BluChem anti-corrosion treatment, a Massair CT custom catalogue service.
-- NOT APPLIED until go-live. Does not touch supplier_products or any price list.
--
-- Sell price R3,300.00 excl. VAT (R3,795.00 incl. VAT at 15%) per outdoor unit.
-- The price lives on catalog_services.default_unit_price. A quote copies it onto
-- the line; editing that line updates quote_items only.
--
-- Idempotent: a second run updates the same Massair row and does not insert another.
-- Rollback: 20261124190000_bluchem_custom_service_ROLLBACK.sql

ALTER TABLE public.catalog_services
  ADD COLUMN IF NOT EXISTS default_unit_price numeric,
  ADD COLUMN IF NOT EXISTS unit text;

COMMENT ON COLUMN public.catalog_services.default_unit_price IS
  'Default sell price excl. VAT copied onto a new quote line. Editing the quote line never writes this column.';

INSERT INTO public.catalog_services (
  name, description, origin, owner_company_id, is_active, unit, default_unit_price, search_aliases
)
SELECT
  'BluChem anti-corrosion treatment (outdoor unit)',
  'Bluchem BluGuard anti-corrosion coil coating applied to the outdoor unit. Protects against coastal salt-air corrosion; extended warranty applies when annual cleaning is recorded.',
  'custom',
  '361bf031-9cdb-4d7f-9bde-9eb95fa4725e',
  true,
  'each',
  3300,
  ARRAY['bluchem','blu chem','bluguard','anti-corrosion','anticorrosion','corrosion','coastal','coating']
WHERE NOT EXISTS (
  SELECT 1 FROM public.catalog_services
  WHERE owner_company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
    AND origin = 'custom'
    AND name = 'BluChem anti-corrosion treatment (outdoor unit)'
);

UPDATE public.catalog_services
SET
  description = 'Bluchem BluGuard anti-corrosion coil coating applied to the outdoor unit. Protects against coastal salt-air corrosion; extended warranty applies when annual cleaning is recorded.',
  is_active = true,
  unit = 'each',
  default_unit_price = 3300,
  search_aliases = ARRAY['bluchem','blu chem','bluguard','anti-corrosion','anticorrosion','corrosion','coastal','coating']
WHERE owner_company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
  AND origin = 'custom'
  AND name = 'BluChem anti-corrosion treatment (outdoor unit)';
