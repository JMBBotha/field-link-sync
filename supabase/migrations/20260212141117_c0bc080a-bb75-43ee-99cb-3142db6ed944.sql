
-- Add bundle_type to installation_bundles
ALTER TABLE public.installation_bundles ADD COLUMN IF NOT EXISTS bundle_type text DEFAULT 'full_install_kit';

-- Add is_optional to bundle_items
ALTER TABLE public.bundle_items ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;
