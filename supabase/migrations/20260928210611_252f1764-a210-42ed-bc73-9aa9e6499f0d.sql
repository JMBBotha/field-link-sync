ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS default_install_labour_hours numeric NOT NULL DEFAULT 3.5;

COMMENT ON COLUMN public.company_settings.default_install_labour_hours IS
  'Default installation labour hours per AC unit for new area labour lines.';

-- Rollback:
-- ALTER TABLE public.company_settings DROP COLUMN default_install_labour_hours;