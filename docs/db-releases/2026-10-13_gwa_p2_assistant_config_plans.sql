-- Grok work assistant phase 2 + company plans structure (Johan 2026-10-13 13:41). ADDITIVE ONLY.
-- Rollback: docs/db-releases/2026-10-13_gwa_p2_rollback.sql
-- 1) Per-company Mandy name + voice (one shared bot definition; only these fields per company).
CREATE TABLE IF NOT EXISTS public.company_assistant_config (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  bot_name text NOT NULL DEFAULT 'Mandy' CHECK (char_length(btrim(bot_name)) BETWEEN 1 AND 24),
  voice_id text NOT NULL DEFAULT 'liora' CHECK (voice_id IN ('liora','eve','ara','rex','leo')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_assistant_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cac_select ON public.company_assistant_config;
CREATE POLICY cac_select ON public.company_assistant_config FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.is_master_company_user(auth.uid()));
DROP POLICY IF EXISTS cac_insert ON public.company_assistant_config;
CREATE POLICY cac_insert ON public.company_assistant_config FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)
              AND NOT public.is_sales_rep(auth.uid()));
DROP POLICY IF EXISTS cac_update ON public.company_assistant_config;
CREATE POLICY cac_update ON public.company_assistant_config FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role) AND NOT public.is_sales_rep(auth.uid()))
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.company_assistant_config TO authenticated;
CREATE OR REPLACE FUNCTION public._cac_stamp() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); NEW.updated_by := auth.uid(); NEW.bot_name := btrim(NEW.bot_name); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_cac_stamp ON public.company_assistant_config;
CREATE TRIGGER trg_cac_stamp BEFORE INSERT OR UPDATE ON public.company_assistant_config FOR EACH ROW EXECUTE FUNCTION public._cac_stamp();
INSERT INTO public.company_assistant_config (company_id) SELECT id FROM public.companies ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public._cac_new_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN INSERT INTO public.company_assistant_config (company_id) VALUES (NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_cac_new_company ON public.companies;
CREATE TRIGGER trg_cac_new_company AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public._cac_new_company();

-- 2) Company-level plan structure (NO billing, NO provider; billing_live stays false until Johan says).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS plan_code text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'pending_contract',
  ADD COLUMN IF NOT EXISTS plan_base_price_zar numeric(10,2) NOT NULL DEFAULT 4500,
  ADD COLUMN IF NOT EXISTS plan_included_users int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS plan_extra_user_price_zar numeric(10,2) NOT NULL DEFAULT 149,
  ADD COLUMN IF NOT EXISTS plan_contract_months int NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_signed_by uuid,
  ADD COLUMN IF NOT EXISTS contract_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS mandy_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_live boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.companies ADD CONSTRAINT companies_plan_status_chk
    CHECK (plan_status IN ('pending_contract','active','grace','suspended','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Existing companies keep working (grandfathered as active, contract not yet signed).
UPDATE public.companies SET plan_status = 'active' WHERE plan_status = 'pending_contract' AND created_at < now();

-- Only Massair (master) admins (or server/service) may change plan fields.
CREATE OR REPLACE FUNCTION public._companies_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF (NEW.plan_code, NEW.plan_status, NEW.plan_base_price_zar, NEW.plan_included_users, NEW.plan_extra_user_price_zar,
      NEW.plan_contract_months, NEW.contract_signed_at, NEW.contract_signed_by, NEW.contract_ends_at, NEW.plan_grace_until,
      NEW.mandy_enabled, NEW.billing_live)
     IS DISTINCT FROM
     (OLD.plan_code, OLD.plan_status, OLD.plan_base_price_zar, OLD.plan_included_users, OLD.plan_extra_user_price_zar,
      OLD.plan_contract_months, OLD.contract_signed_at, OLD.contract_signed_by, OLD.contract_ends_at, OLD.plan_grace_until,
      OLD.mandy_enabled, OLD.billing_live)
     AND NOT (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)) THEN
    RAISE EXCEPTION 'Plan settings can only be changed by the main system (Massair).';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_companies_plan_guard ON public.companies;
CREATE TRIGGER trg_companies_plan_guard BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public._companies_plan_guard();
