CREATE OR REPLACE FUNCTION public.delete_or_archive_client(p_customer_id uuid, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.trg_invoice_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_unlock boolean := COALESCE(current_setting('app.invoice_unlock', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.company_profile_id IS NULL AND NEW.company_id IS NOT NULL THEN
      NEW.company_profile_id := public.default_company_profile(NEW.company_id);
    END IF;
    IF NEW.billed_to_vat_number IS NULL AND NEW.customer_id IS NOT NULL THEN
      SELECT NULLIF(btrim(vat_number), '') INTO NEW.billed_to_vat_number FROM public.customers WHERE id = NEW.customer_id;
    END IF;
  END IF;
  IF NEW.company_profile_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.company_profiles cp WHERE cp.id = NEW.company_profile_id AND cp.company_id IS NOT DISTINCT FROM NEW.company_id) THEN
    RAISE EXCEPTION 'Company profile belongs to another company' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft' AND NOT v_unlock THEN
    IF NEW.status = 'draft' THEN RAISE EXCEPTION 'Invoice % is already %, it cannot go back to draft (duplicate it instead)', OLD.invoice_number, OLD.status; END IF;
    IF (NEW.invoice_number, NEW.customer_name, NEW.customer_phone, NEW.customer_address, NEW.customer_email, NEW.customer_id,
        NEW.line_items, NEW.subtotal, NEW.tax_rate, NEW.tax_amount, NEW.grand_total, NEW.issue_date,
        NEW.discount_type, NEW.discount_value, NEW.discount_amount, NEW.company_profile_id, NEW.billed_to_vat_number, NEW.company_id)
       IS DISTINCT FROM
       (OLD.invoice_number, OLD.customer_name, OLD.customer_phone, OLD.customer_address, OLD.customer_email, OLD.customer_id,
        OLD.line_items, OLD.subtotal, OLD.tax_rate, OLD.tax_amount, OLD.grand_total, OLD.issue_date,
        OLD.discount_type, OLD.discount_value, OLD.discount_amount, OLD.company_profile_id, OLD.billed_to_vat_number, OLD.company_id) THEN
      RAISE EXCEPTION 'Invoice % is % and locked. Duplicate it or use a credit note to change it.', OLD.invoice_number, OLD.status
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Deposit request: % of the VAT-inclusive total, or a fixed amount
  IF NEW.deposit_type IS NULL THEN
    NEW.deposit_value := NULL; NEW.deposit_amount := NULL;
  ELSIF NEW.deposit_type = 'percent' THEN
    IF NEW.deposit_value IS NULL OR NEW.deposit_value <= 0 OR NEW.deposit_value > 100 THEN
      RAISE EXCEPTION 'Deposit %% must be between 0 and 100'; END IF;
    NEW.deposit_amount := round(COALESCE(NEW.grand_total, 0) * NEW.deposit_value / 100, 2);
  ELSE
    IF NEW.deposit_value IS NULL OR NEW.deposit_value <= 0 OR NEW.deposit_value > COALESCE(NEW.grand_total, 0) + 0.005 THEN
      RAISE EXCEPTION 'Deposit amount must be more than 0 and not more than the invoice total'; END IF;
    NEW.deposit_amount := round(NEW.deposit_value, 2);
  END IF;

  IF NEW.status IS DISTINCT FROM 'draft' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    NEW.sent_at := COALESCE(NEW.sent_at, now());
    IF NEW.company_profile_id IS NOT NULL THEN
      NEW.profile_snapshot := public.company_profile_snapshot(NEW.company_profile_id);
    END IF;
  END IF;
  RETURN NEW;
END $function$
;