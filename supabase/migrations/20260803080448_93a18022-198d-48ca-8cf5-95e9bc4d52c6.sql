ALTER FUNCTION public.search_supplier_products(text, text, text, text, integer) SET search_path = public;

DROP POLICY IF EXISTS "Authenticated users can create companies" ON public.companies;
CREATE POLICY "Signed-in users can create companies" ON public.companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role manages email_events" ON public.email_events;
DROP POLICY IF EXISTS "Service role manages email_preferences" ON public.email_preferences;

DO $$
DECLARE r record;
  -- helpers referenced inside RLS policies: must stay executable by every role
  policy_helpers text[] := ARRAY['has_role','get_user_company_id','is_company_member','is_company_admin',
    'user_can_access_job_company','user_can_update_assigned_job','user_is_assigned_to_job','validate_customer_token',
    'calculate_distance_km','normalize_phone'];
  keep_anon text[] := ARRAY['accept_quote_by_token','decline_quote_by_token','get_quote_by_public_token','create_portal_booking'];
  keep_auth text[] := ARRAY['agent_performance_scores','check_customer_duplicates','convert_lead_to_customer','generate_invoice_number',
    'generate_maintenance_schedules','generate_proposal_number','get_agents_within_radius','get_agreements_due_for_service',
    'get_completed_jobs','get_my_assigned_jobs','get_or_create_customer_token','get_overdue_maintenance_count','increment_product_usage',
    'is_agent_available_now','mark_overdue_maintenance','past_quote_analytics','search_customers','search_supplier_products',
    'accept_lead','release_lead','broadcast_lead_to_agents'];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, t.typname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public' AND p.prosecdef AND t.typname <> 'trigger'
  LOOP
    CONTINUE WHEN r.proname = ANY(policy_helpers);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
    IF r.proname = ANY(keep_anon) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated', r.proname, r.args);
    ELSIF r.proname = ANY(keep_auth) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, r.args);
    END IF;
  END LOOP;
END $$;