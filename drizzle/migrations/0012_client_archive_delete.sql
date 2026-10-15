-- Clients: archive (status='archived', reversible) or delete permanently only when no money/work history.
CREATE OR REPLACE FUNCTION public.delete_or_archive_client(p_customer_id uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.customers%ROWTYPE; v_links text[] := '{}';
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'dispatcher')) THEN
    RAISE EXCEPTION 'Only office staff can archive or delete clients' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF c.id IS NULL OR c.company_id IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Client not found'; END IF;

  IF p_mode = 'archive' THEN
    UPDATE public.customers SET status = 'archived', updated_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('status','archived');
  ELSIF p_mode = 'restore' THEN
    UPDATE public.customers SET status = 'active', updated_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('status','active');
  ELSIF p_mode = 'delete' THEN
    IF EXISTS (SELECT 1 FROM public.quotes WHERE customer_id = c.id) THEN v_links := v_links || 'quotes'::text; END IF;
    IF EXISTS (SELECT 1 FROM public.invoices WHERE customer_id = c.id) THEN v_links := v_links || 'invoices'::text; END IF;
    IF EXISTS (SELECT 1 FROM public.jobs WHERE customer_id = c.id) THEN v_links := v_links || 'jobs'::text; END IF;
    IF EXISTS (SELECT 1 FROM public.leads WHERE customer_id = c.id) THEN v_links := v_links || 'leads'::text; END IF;
    IF EXISTS (SELECT 1 FROM public.proposals WHERE customer_id = c.id)
       OR EXISTS (SELECT 1 FROM public.company_invoices WHERE customer_id = c.id)
       OR EXISTS (SELECT 1 FROM public.maintenance_schedules WHERE customer_id = c.id)
       OR EXISTS (SELECT 1 FROM public.statement_links WHERE customer_id = c.id) THEN v_links := v_links || 'other records'::text; END IF;
    IF array_length(v_links,1) IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','links', to_jsonb(v_links));
    END IF;
    DELETE FROM public.customer_notes WHERE customer_id = c.id;
    DELETE FROM public.customers WHERE id = c.id;
    RETURN jsonb_build_object('status','deleted');
  END IF;
  RAISE EXCEPTION 'Unknown action';
END $$;
REVOKE ALL ON FUNCTION public.delete_or_archive_client(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_or_archive_client(uuid, text) TO authenticated;