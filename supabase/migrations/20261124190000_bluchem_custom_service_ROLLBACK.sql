-- Rollback for 20261124190000_bluchem_custom_service.sql. Not applied until go-live.
-- Removes the Massair BluChem custom service. Drops the price columns only when
-- no other service is using them. Does not touch supplier_products.

DELETE FROM public.catalog_services
WHERE owner_company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
  AND origin = 'custom'
  AND name = 'BluChem anti-corrosion treatment (outdoor unit)';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.catalog_services
    WHERE default_unit_price IS NOT NULL OR unit IS NOT NULL
  ) THEN
    ALTER TABLE public.catalog_services DROP COLUMN IF EXISTS unit;
    ALTER TABLE public.catalog_services DROP COLUMN IF EXISTS default_unit_price;
  END IF;
END $$;
