-- A. companies
DROP POLICY IF EXISTS "public_read" ON public.companies;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own company" ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), id) OR id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Authenticated users can create companies" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
REVOKE ALL ON public.companies FROM anon;

-- B. fb_* tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fb_contacts','fb_estimates','fb_expenses','fb_invoices','fb_payments','fb_projects','fb_time_entries']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'public_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'public_insert', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- C. company_invoices anon policies
DROP POLICY IF EXISTS "Public delete company invoices" ON public.company_invoices;
DROP POLICY IF EXISTS "Public insert company invoices" ON public.company_invoices;
DROP POLICY IF EXISTS "Public read company invoices" ON public.company_invoices;
DROP POLICY IF EXISTS "Public update company invoices" ON public.company_invoices;

-- D. dead tenant isolation policies
DROP POLICY IF EXISTS "tenant_isolation" ON public.customers;
DROP POLICY IF EXISTS "tenant_isolation" ON public.quotes;

-- E. profiles
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
CREATE POLICY "Users can view profiles in their company" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR (company_id IS NOT NULL AND company_id = public.get_user_company_id(auth.uid()))
  );

-- F. quote_areas scoped to owning quote
DROP POLICY IF EXISTS "Users can delete quote areas" ON public.quote_areas;
DROP POLICY IF EXISTS "Users can insert quote areas" ON public.quote_areas;
DROP POLICY IF EXISTS "Users can update quote areas" ON public.quote_areas;
DROP POLICY IF EXISTS "Users can view quote areas" ON public.quote_areas;
CREATE POLICY "Owners can view quote areas" ON public.quote_areas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_areas.quote_id
    AND (q.sales_engineer_id = auth.uid() OR q.company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role))));
CREATE POLICY "Owners can insert quote areas" ON public.quote_areas FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_areas.quote_id
    AND (q.sales_engineer_id = auth.uid() OR q.company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role))));
CREATE POLICY "Owners can update quote areas" ON public.quote_areas FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_areas.quote_id
    AND (q.sales_engineer_id = auth.uid() OR q.company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_areas.quote_id
    AND (q.sales_engineer_id = auth.uid() OR q.company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role))));
CREATE POLICY "Owners can delete quote areas" ON public.quote_areas FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_areas.quote_id
    AND (q.sales_engineer_id = auth.uid() OR q.company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role))));

-- G. quote_line_items anon token leak + anon quote update
DROP POLICY IF EXISTS "Public can view quote line items by token" ON public.quote_line_items;
DROP POLICY IF EXISTS "Anon can accept quote by specific token" ON public.quotes;

-- H. supplier catalog write scoping
DROP POLICY IF EXISTS "Authenticated users can delete supplier products" ON public.supplier_products;
DROP POLICY IF EXISTS "Authenticated users can insert supplier products" ON public.supplier_products;
DROP POLICY IF EXISTS "Authenticated users can update supplier products" ON public.supplier_products;

DROP POLICY IF EXISTS "Authenticated users can delete pdf pages" ON public.supplier_pdf_pages;
DROP POLICY IF EXISTS "Authenticated users can insert pdf pages" ON public.supplier_pdf_pages;
DROP POLICY IF EXISTS "Authenticated users can update pdf pages" ON public.supplier_pdf_pages;
CREATE POLICY "Admins can manage pdf pages" ON public.supplier_pdf_pages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated users can delete pdf regions" ON public.pdf_product_regions;
DROP POLICY IF EXISTS "Authenticated users can insert pdf regions" ON public.pdf_product_regions;
DROP POLICY IF EXISTS "Authenticated users can update pdf regions" ON public.pdf_product_regions;
CREATE POLICY "Admins can manage pdf regions" ON public.pdf_product_regions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated users can manage pdf_uploads" ON public.pdf_uploads;
CREATE POLICY "Authenticated users can view pdf_uploads" ON public.pdf_uploads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage pdf_uploads" ON public.pdf_uploads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

-- I. other always-true write policies
DROP POLICY IF EXISTS "Allow authenticated delete supplier_locations" ON public.supplier_locations;
DROP POLICY IF EXISTS "Allow authenticated insert supplier_locations" ON public.supplier_locations;
DROP POLICY IF EXISTS "Allow authenticated update supplier_locations" ON public.supplier_locations;
CREATE POLICY "Admins can manage supplier_locations" ON public.supplier_locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated users can manage import_audit_log" ON public.import_audit_log;
CREATE POLICY "Authenticated users can view import_audit_log" ON public.import_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage import_audit_log" ON public.import_audit_log FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Allow service role full access to email_events" ON public.email_events;
CREATE POLICY "Service role manages email_events" ON public.email_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow service role full access to email_preferences" ON public.email_preferences;
CREATE POLICY "Service role manages email_preferences" ON public.email_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);

-- J. materialized view out of the API
REVOKE ALL ON public.company_stats FROM anon, authenticated;

-- K. function search_path
ALTER FUNCTION public.get_recently_active_customers(uuid, integer) SET search_path = public;
ALTER FUNCTION public.validate_company_status() SET search_path = public;
ALTER FUNCTION public.validate_profile_participant_type() SET search_path = public;
ALTER FUNCTION public.search_supplier_products(text, text, uuid, integer) SET search_path = public;
ALTER FUNCTION public.search_supplier_products(text, text, uuid, integer, boolean) SET search_path = public;

-- L. revoke EXECUTE on SECURITY DEFINER functions not meant to be called via the API
DO $$
DECLARE r record;
  keep_anon text[] := ARRAY['accept_quote_by_token','decline_quote_by_token','get_quote_by_public_token','create_portal_booking','validate_customer_token'];
  keep_auth text[] := ARRAY['accept_quote_by_token','decline_quote_by_token','get_quote_by_public_token','create_portal_booking','validate_customer_token',
    'agent_performance_scores','check_customer_duplicates','convert_lead_to_customer','generate_invoice_number','generate_maintenance_schedules',
    'generate_proposal_number','get_agents_within_radius','get_agreements_due_for_service','get_completed_jobs','get_my_assigned_jobs',
    'get_or_create_customer_token','get_overdue_maintenance_count','has_role','increment_product_usage','mark_overdue_maintenance',
    'past_quote_analytics','search_customers','search_supplier_products','is_company_member','is_company_admin','get_user_company_id',
    'user_can_access_job_company','user_can_update_assigned_job','user_is_assigned_to_job','is_agent_available_now','calculate_distance_km',
    'accept_lead','release_lead','broadcast_lead_to_agents','normalize_phone'];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args, t.typname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    IF r.typname = 'trigger' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    ELSE
      IF NOT (r.proname = ANY(keep_anon)) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
      END IF;
      IF NOT (r.proname = ANY(keep_auth)) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, authenticated', r.proname, r.args);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
      END IF;
    END IF;
  END LOOP;
END $$;

-- M. public buckets: stop anonymous listing (direct public object URLs are unaffected)
DROP POLICY IF EXISTS "Anyone can read product brochures" ON storage.objects;
DROP POLICY IF EXISTS "Public read product brochures" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view company logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view pdf pages" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view product images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view quote photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for pdf page temps" ON storage.objects;
CREATE POLICY "Signed-in users can list public assets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('product-brochures','company-logos','supplier-pdf-pages','product-images','quote-photos','pdf-page-temps','pdfs'));
