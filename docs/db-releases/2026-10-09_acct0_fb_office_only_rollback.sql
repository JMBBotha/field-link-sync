-- Rollback accounting step 0
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fb_contacts','fb_estimates','fb_expenses','fb_invoices','fb_payments','fb_projects','fb_time_entries','company_invoices'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS acct0_office_only ON public.%I', t);
  END LOOP;
END $$;
