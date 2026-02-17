
-- Add material favorite flag to supplier_products
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS is_material_favorite boolean NOT NULL DEFAULT false;

-- Add bundle matching columns to installation_bundles
ALTER TABLE public.installation_bundles ADD COLUMN IF NOT EXISTS min_btu integer;
ALTER TABLE public.installation_bundles ADD COLUMN IF NOT EXISTS max_btu integer;
ALTER TABLE public.installation_bundles ADD COLUMN IF NOT EXISTS compatible_brands text[];
ALTER TABLE public.installation_bundles ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
