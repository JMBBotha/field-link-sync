-- Cross-company scoping for SECURITY DEFINER money/catalogue functions (2026-09-30). Rollback: rollback.sql
-- Company always comes from the caller (profile, else single membership); never from a parameter.
-- Catalogue functions follow the supplier_products table policy (master company or approved network member).
CREATE OR REPLACE FUNCTION public.caller_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT min(cm.company_id::text)::uuid FROM public.company_members cm
      WHERE cm.user_id = auth.uid() HAVING count(DISTINCT cm.company_id) = 1));
$$;
REVOKE ALL ON FUNCTION public.caller_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_company_id() TO authenticated;

DO $x$
DECLARE r record; d text; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.revenue_by_agent()', $q$WHERE i.status = 'paid'
  GROUP BY p.full_name$q$, $q$WHERE i.status = 'paid' AND i.company_id = public.caller_company_id() /*xco*/
  GROUP BY p.full_name$q$, 1),
    ('public.revenue_by_service_type()', $q$WHERE i.status = 'paid'
  GROUP BY cs.name$q$, $q$WHERE i.status = 'paid' AND i.company_id = public.caller_company_id() /*xco*/
  GROUP BY cs.name$q$, 1),
    ('public.revenue_trend_monthly()', $q$AND i.status = 'paid'
  GROUP BY gs.m$q$, $q$AND i.status = 'paid' AND i.company_id = public.caller_company_id() /*xco*/
  GROUP BY gs.m$q$, 1),
    ('public.job_profit_loss(uuid)', $q$FROM invoices WHERE lead_id = p_lead_id AND status = 'paid'$q$, $q$FROM invoices WHERE lead_id = p_lead_id AND status = 'paid' AND company_id = public.caller_company_id() /*xco*/$q$, 2),
    ('public.job_profit_loss(uuid)', $q$FROM job_expenses je WHERE je.lead_id = p_lead_id$q$, $q$FROM job_expenses je WHERE je.lead_id = p_lead_id AND EXISTS (SELECT 1 FROM leads l WHERE l.id = p_lead_id AND l.company_id = public.caller_company_id()) /*xco*/$q$, 2),
    ('public.get_invoice_aging_report()', $q$AND i.due_date IS NOT NULL
$q$, $q$AND i.due_date IS NOT NULL AND i.company_id = public.caller_company_id() /*xco*/
$q$, 1),
    ('public.agent_performance_scores()', $q$LEFT JOIN leads l ON l.assigned_agent_id = p.id AND l.status = 'completed'$q$, $q$LEFT JOIN leads l ON l.assigned_agent_id = p.id AND l.status = 'completed' AND l.company_id = public.caller_company_id() /*xco*/$q$, 2),
    ('public.agent_performance_scores()', $q$LEFT JOIN invoices inv ON inv.agent_id = p.id AND inv.status = 'paid'$q$, $q$LEFT JOIN invoices inv ON inv.agent_id = p.id AND inv.status = 'paid' AND inv.company_id = public.caller_company_id() /*xco*/$q$, 2),
    ('public.past_quote_analytics(text)', $q$WHERE q.status IN ('accepted', 'sent', 'viewed')$q$, $q$WHERE q.status IN ('accepted', 'sent', 'viewed')
    AND (auth.uid() IS NULL OR COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) = public.caller_company_id()) /*xco*/$q$, 1),
    ('public.quote_conversion_funnel()', $q$FROM quotes q
  GROUP BY q.status$q$, $q$FROM quotes q
  WHERE COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) = public.caller_company_id() /*xco*/
  GROUP BY q.status$q$, 1),
    ('public.get_company_margin_settings(uuid)', $q$AND (public.has_role(auth.uid(), 'admin'::app_role) OR$q$, $q$AND ((public.has_role(auth.uid(), 'admin'::app_role) AND c.id = public.caller_company_id() /*xco*/) OR$q$, 1),
    ('public.get_job_used_parts(uuid)', $q$OR public.has_role(auth.uid(), 'admin'::app_role))
  ORDER BY u.created_at$q$, $q$OR (public.has_role(auth.uid(), 'admin'::app_role) AND l.company_id = public.caller_company_id() /*xco*/))
  ORDER BY u.created_at$q$, 1),
    ('public.delete_job_used_part(uuid)', $q$OR public.has_role(auth.uid(), 'admin'::app_role));$q$, $q$OR (public.has_role(auth.uid(), 'admin'::app_role) AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_used_parts.lead_id AND l.company_id = public.caller_company_id()) /*xco*/));$q$, 1),
    ('public.invoice_amount_paid(uuid)', $q$AND status IN ('paid', 'succeeded', 'completed');$q$, $q$AND status IN ('paid', 'succeeded', 'completed')
    AND (auth.uid() IS NULL OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id AND i.company_id = public.caller_company_id())) /*xco*/;$q$, 1),
    ('public.get_job_billable_hours(uuid)', $q$WHERE lead_id = p_lead_id AND is_billable = true;$q$, $q$WHERE lead_id = p_lead_id AND is_billable = true
    AND (auth.uid() IS NULL OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND l.company_id = public.caller_company_id())) /*xco*/;$q$, 1),
    ('public.convert_time_to_invoice_items(uuid,uuid,numeric)', $q$BEGIN
  FOR v_entry IN$q$, $q$BEGIN
  IF auth.uid() IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND l.company_id = public.caller_company_id())
     OR NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id AND i.company_id = public.caller_company_id())) THEN
    RAISE EXCEPTION 'Not authorized for this job' USING ERRCODE = '42501'; END IF; /*xco*/
  FOR v_entry IN$q$, 1),
    ('public.create_deposit_invoice_for_quote(uuid)', $q$IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;$q$, $q$IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not authorized for this quote' USING ERRCODE = '42501'; END IF; /*xco*/$q$, 1),
    ('public.search_supplier_products(text,text,uuid,integer)', $q$-- tech_lockdown_guard
  RETURN QUERY$q$, $q$-- tech_lockdown_guard
  IF NOT public.can_read_master_catalog(auth.uid()) THEN RETURN; END IF; /*xco*/
  RETURN QUERY$q$, 1),
    ('public.search_supplier_products(text,text,uuid,integer,boolean)', $q$-- tech_lockdown_guard
  RETURN QUERY$q$, $q$-- tech_lockdown_guard
  IF NOT public.can_read_master_catalog(auth.uid()) THEN RETURN; END IF; /*xco*/
  RETURN QUERY$q$, 1),
    ('public.link_products_to_pdf_book(uuid)', $q$-- tech_lockdown_guard
  SELECT supplier_id$q$, $q$-- tech_lockdown_guard
  IF NOT public.is_master_company_user(auth.uid()) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF; /*xco*/
  SELECT supplier_id$q$, 1),
    ('public.activate_pdf_book_gate(uuid,integer)', $q$-- tech_lockdown_guard
ORDER BY 11, 1;$q$, $q$-- tech_lockdown_guard
  AND public.can_read_master_catalog(auth.uid()) /*xco*/
ORDER BY 11, 1;$q$, 1),
    ('public.increment_product_usage(uuid)', $q$BEGIN
  UPDATE supplier_products$q$, $q$BEGIN
  IF NOT public.can_read_master_catalog(auth.uid()) THEN RETURN; END IF; /*xco*/
  UPDATE supplier_products$q$, 1)
  ) v(f, o, nw, cnt) LOOP
    d := pg_get_functiondef(r.f::regprocedure);
    n := (length(d) - length(replace(d, r.o, ''))) / length(r.o);
    IF n <> r.cnt THEN RAISE EXCEPTION 'cross_company: % expected % match(es), found %', r.f, r.cnt, n; END IF;
    EXECUTE replace(d, r.o, r.nw);
  END LOOP;
END $x$;