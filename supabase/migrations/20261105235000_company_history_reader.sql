-- Rollback: supabase/manual/20261105235000_company_history_reader_rollback.sql
-- The company shell (/client/:id) lists company_invoices / fb_estimates / fb_contacts /
-- fb_payments. The FreshBooks import is in public.invoices, invoice_items, payments,
-- quotes and customers. Those rows are also invisible to a member whose profile company
-- is a different company, because invoices_select_policy requires
-- company_id = get_user_company_id(). These readers do not change that policy, so the
-- live CT invoice list stays CT-only. A caller may read one company only when p4_co_ok
-- already allows it (their profile company, a company they belong to, or platform).

CREATE OR REPLACE FUNCTION public.company_history_invoices(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.p4_co_ok(p_company) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.issue_date DESC NULLS LAST, x.invoice_number DESC)
    FROM (
      SELECT i.id, i.invoice_number, i.customer_name, i.customer_id, i.status,
             i.grand_total, i.issue_date, i.due_date, i.archived_at,
             c.status AS customer_status,
             round(coalesce((
               SELECT sum(p.amount) FROM public.payments p
               WHERE p.invoice_id = i.id AND p.status IN ('paid', 'succeeded', 'completed')
             ), 0), 2) AS paid
      FROM public.invoices i
      LEFT JOIN public.customers c ON c.id = i.customer_id AND c.company_id = i.company_id
      WHERE i.company_id = p_company
    ) x
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.company_history_invoice(p_company uuid, p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invoices%ROWTYPE;
  lines jsonb;
  pays jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.p4_co_ok(p_company) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice AND company_id = p_company;
  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sort_order, l.created_at), '[]'::jsonb) INTO lines
  FROM (
    SELECT id, description, line_name, quantity, unit_price, amount, sort_order, created_at
    FROM public.invoice_items WHERE invoice_id = inv.id
  ) l;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.payment_date DESC NULLS LAST), '[]'::jsonb) INTO pays
  FROM (
    SELECT id, amount, status, method, reference, payment_date
    FROM public.payments WHERE invoice_id = inv.id
  ) p;
  RETURN jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', inv.id, 'invoice_number', inv.invoice_number, 'customer_name', inv.customer_name,
      'customer_id', inv.customer_id, 'status', inv.status, 'grand_total', inv.grand_total,
      'issue_date', inv.issue_date, 'due_date', inv.due_date, 'archived_at', inv.archived_at,
      'company_id', inv.company_id
    ),
    'lines', lines,
    'payments', pays
  );
END $$;

CREATE OR REPLACE FUNCTION public.company_history_quotes(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.p4_co_ok(p_company) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT id, quote_number, customer_name, status, total, archived_at, created_at
      FROM public.quotes WHERE company_id = p_company
    ) x
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.company_history_customers(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.p4_co_ok(p_company) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name)
    FROM (
      SELECT id, name, status, email, phone FROM public.customers WHERE company_id = p_company
    ) x
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.company_history_payments(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.p4_co_ok(p_company) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.payment_date DESC NULLS LAST)
    FROM (
      SELECT p.id, p.amount, p.status, p.method, p.reference, p.payment_date, p.invoice_id, i.invoice_number
      FROM public.payments p
      JOIN public.invoices i ON i.id = p.invoice_id AND i.company_id = p_company
    ) x
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.company_history_invoices(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_history_invoice(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_history_quotes(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_history_customers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_history_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_history_invoices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_history_invoice(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_history_quotes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_history_customers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_history_payments(uuid) TO authenticated;
