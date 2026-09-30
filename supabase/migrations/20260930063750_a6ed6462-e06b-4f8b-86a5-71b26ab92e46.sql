-- Tech cost/invoice lockdown (2026-09-30). Rollback: rollback.sql
-- 1) Helper: pure field tech (field_agent role or technician dispatch_role) with no ops/admin rights.
CREATE OR REPLACE FUNCTION public.is_field_tech_only(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
    AND (public.has_role(_uid, 'field_agent'::app_role)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.dispatch_role = 'technician'))
    AND NOT public.is_ops_user(_uid)
    AND NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = _uid AND cm.role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_field_tech_only(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_field_tech_only(uuid) TO authenticated;

-- 2) Restrictive SELECT policies (other roles unaffected: policy is TRUE for them).
DO $pol$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_products','suppliers','brand_discounts','inventory_items','pdf_uploads',
                           'stock_receipts','payment_events','fb_invoices','fb_payments','company_invoices','job_used_parts','job_completions'] LOOP
    EXECUTE format('CREATE POLICY tech_lockdown_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())))', t);
  END LOOP;
END $pol$;
-- Techs keep ONLY invoices they authored themselves (field "Create Invoice" flow needs insert...returning).
CREATE POLICY tech_lockdown_select ON public.invoices AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR agent_id = auth.uid());
CREATE POLICY tech_lockdown_select ON public.invoice_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid()))
         OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.agent_id = auth.uid()));
CREATE POLICY tech_lockdown_select ON public.payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid()))
         OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = payments.invoice_id AND i.agent_id = auth.uid()));

-- 3) Used parts: RPC list (cost only for non-techs) + RPC delete (mirrors existing policies).
CREATE OR REPLACE FUNCTION public.get_job_used_parts(p_lead_id uuid)
RETURNS TABLE(id uuid, product_id uuid, product_code text, product_name text, quantity integer,
              unit_cost numeric, line_total numeric, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.product_id, u.product_code, u.product_name, u.quantity::integer,
         CASE WHEN public.is_field_tech_only(auth.uid()) THEN NULL ELSE u.unit_cost END,
         CASE WHEN public.is_field_tech_only(auth.uid()) THEN NULL ELSE u.line_total END,
         u.created_at
  FROM public.job_used_parts u
  JOIN public.leads l ON l.id = u.lead_id
  WHERE u.lead_id = p_lead_id AND auth.uid() IS NOT NULL
    AND (l.assigned_agent_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  ORDER BY u.created_at;
$$;
REVOKE ALL ON FUNCTION public.get_job_used_parts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_job_used_parts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_job_used_part(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.job_used_parts
   WHERE id = p_id AND (added_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public.delete_job_used_part(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_job_used_part(uuid) TO authenticated;

-- 4) job_completions.parts_total (cost total): computed server-side; techs cannot read job_completions rows (restrictive policy above).
CREATE OR REPLACE FUNCTION public.job_completions_server_parts_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    NEW.parts_total := COALESCE((SELECT sum(u.line_total) FROM public.job_used_parts u WHERE u.lead_id = NEW.lead_id), 0);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.job_completions_server_parts_total() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_job_completions_server_parts_total BEFORE INSERT OR UPDATE ON public.job_completions
  FOR EACH ROW EXECUTE FUNCTION public.job_completions_server_parts_total();

-- 5) Guard security-definer money RPCs against pure techs (text-inserted after first BEGIN).
DO $g$
DECLARE f regprocedure; d text; i int; j int;
  guard constant text := E'\n  IF public.is_field_tech_only(auth.uid()) THEN RAISE EXCEPTION ''Not available to technicians'' USING ERRCODE = ''42501''; END IF; -- tech_lockdown_guard';
BEGIN
  FOREACH f IN ARRAY ARRAY['public.search_supplier_products(text,text,uuid,integer)','public.search_supplier_products(text,text,uuid,integer,boolean)',
      'public.link_products_to_pdf_book(uuid)','public.job_profit_loss(uuid)','public.revenue_by_agent()',
      'public.revenue_by_service_type()','public.get_invoice_aging_report()']::regprocedure[] LOOP
    d := pg_get_functiondef(f);
    IF strpos(d, 'tech_lockdown_guard') > 0 THEN CONTINUE; END IF;
    i := strpos(d, '$function$');
    j := strpos(substr(d, i), 'BEGIN');
    IF i = 0 OR j = 0 THEN RAISE EXCEPTION 'cannot guard %', f; END IF;
    j := i + j - 1;
    EXECUTE substr(d, 1, j + 4) || guard || substr(d, j + 5);
  END LOOP;
  d := pg_get_functiondef('public.activate_pdf_book_gate(uuid,integer)'::regprocedure);
  IF strpos(d, 'tech_lockdown_guard') = 0 THEN
    IF strpos(d, E'FROM calc\nORDER BY 11, 1;') = 0 THEN RAISE EXCEPTION 'cannot guard activate_pdf_book_gate'; END IF;
    EXECUTE replace(d, E'FROM calc\nORDER BY 11, 1;', E'FROM calc\nWHERE NOT public.is_field_tech_only(auth.uid()) -- tech_lockdown_guard\nORDER BY 11, 1;');
  END IF;
END $g$;

-- 6) Logged-out (anon) must not run the PDF price-book gate (returns cost) or the linker (writes). Admin UI is signed-in.
REVOKE EXECUTE ON FUNCTION public.activate_pdf_book_gate(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_products_to_pdf_book(uuid) FROM anon;