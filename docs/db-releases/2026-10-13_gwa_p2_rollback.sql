-- Rollback for 2026-10-13_gwa_p2_assistant_config_plans.sql
DROP TRIGGER IF EXISTS trg_companies_plan_guard ON public.companies;
DROP FUNCTION IF EXISTS public._companies_plan_guard();
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_plan_status_chk;
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS plan_code, DROP COLUMN IF EXISTS plan_status, DROP COLUMN IF EXISTS plan_base_price_zar,
  DROP COLUMN IF EXISTS plan_included_users, DROP COLUMN IF EXISTS plan_extra_user_price_zar, DROP COLUMN IF EXISTS plan_contract_months,
  DROP COLUMN IF EXISTS contract_signed_at, DROP COLUMN IF EXISTS contract_signed_by, DROP COLUMN IF EXISTS contract_ends_at,
  DROP COLUMN IF EXISTS plan_grace_until, DROP COLUMN IF EXISTS mandy_enabled, DROP COLUMN IF EXISTS billing_live;
DROP TRIGGER IF EXISTS trg_cac_new_company ON public.companies;
DROP FUNCTION IF EXISTS public._cac_new_company();
DROP TABLE IF EXISTS public.company_assistant_config;
DROP FUNCTION IF EXISTS public._cac_stamp();
