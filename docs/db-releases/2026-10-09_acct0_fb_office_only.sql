-- Accounting step 0 (2026-10-09): the dormant /client "FreshBooks copy" tables become office-only.
-- Techs (no money at all) and salespeople (no company finance) are blocked from every fb_* table and company_invoices.
-- Additive restrictive policy only; nothing dropped, no data touched (all these tables have 0 rows).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fb_contacts','fb_estimates','fb_expenses','fb_invoices','fb_payments','fb_projects','fb_time_entries','company_invoices'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS acct0_office_only ON public.%I', t);
    EXECUTE format($p$CREATE POLICY acct0_office_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (NOT (SELECT public.is_field_tech_only(auth.uid())) AND NOT (SELECT public.is_sales_rep(auth.uid())))
      WITH CHECK (NOT (SELECT public.is_field_tech_only(auth.uid())) AND NOT (SELECT public.is_sales_rep(auth.uid())))$p$, t);
  END LOOP;
END $$;
