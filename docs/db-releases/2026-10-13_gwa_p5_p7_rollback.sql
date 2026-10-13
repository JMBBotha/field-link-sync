-- Rollback for 2026-10-13_gwa_p5_p7.sql (restores the p2 plan guard; drops only new objects).
DO $$ BEGIN PERFORM cron.unschedule('plan-enforce-daily'); EXCEPTION WHEN others THEN NULL; END $$;
DROP FUNCTION IF EXISTS public.phone_route_company(text,text);
DROP TABLE IF EXISTS public.phone_company_routes;
DROP FUNCTION IF EXISTS public.plan_enforce_daily();
DROP FUNCTION IF EXISTS public.plan_admin_overview();
DROP FUNCTION IF EXISTS public.plan_admin_set(uuid,text,boolean);
DROP FUNCTION IF EXISTS public.accept_company_contract(text,text,text);
-- NOTE: contract acceptances are kept by default. Uncomment to drop:
-- DROP TABLE IF EXISTS public.company_contracts;
DROP FUNCTION IF EXISTS public.mandy_usage_bump(uuid,uuid,text,int,int,int);
DROP TABLE IF EXISTS public.mandy_usage;
DROP FUNCTION IF EXISTS public.parent_overdue(int);
DROP FUNCTION IF EXISTS public.parent_overview();
DROP FUNCTION IF EXISTS public.is_parent_owner(uuid);
DROP TABLE IF EXISTS public.parent_mandy_users;
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
