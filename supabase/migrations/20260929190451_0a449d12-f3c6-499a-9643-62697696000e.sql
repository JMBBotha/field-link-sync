-- Security gaps "writes" release (2026-09-29). Policy swap + one RPC shape change. No data changes.

-- 1. quote_items writes get the same scope as the read rule: admin, the quote's salesperson/owner/creator, non-sales office staff.
DROP POLICY IF EXISTS "Users can insert their quote items" ON public.quote_items;
DROP POLICY IF EXISTS "Users can update their quote items" ON public.quote_items;
DROP POLICY IF EXISTS "Users can delete their quote items" ON public.quote_items;

CREATE POLICY "Scoped insert of quote items" ON public.quote_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR q.sales_engineer_id = auth.uid() OR q.owner_id = auth.uid() OR q.created_by = auth.uid()
         OR (q.company_id = public.get_user_company_id(auth.uid()) AND public.is_office_staff(auth.uid())))));

CREATE POLICY "Scoped update of quote items" ON public.quote_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR q.sales_engineer_id = auth.uid() OR q.owner_id = auth.uid() OR q.created_by = auth.uid()
         OR (q.company_id = public.get_user_company_id(auth.uid()) AND public.is_office_staff(auth.uid())))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR q.sales_engineer_id = auth.uid() OR q.owner_id = auth.uid() OR q.created_by = auth.uid()
         OR (q.company_id = public.get_user_company_id(auth.uid()) AND public.is_office_staff(auth.uid())))));

CREATE POLICY "Scoped delete of quote items" ON public.quote_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_items.quote_id
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR q.sales_engineer_id = auth.uid() OR q.owner_id = auth.uid() OR q.created_by = auth.uid()
         OR (q.company_id = public.get_user_company_id(auth.uid()) AND public.is_office_staff(auth.uid())))));

-- 2. get_my_assigned_jobs: techs get chip state + remaining only; ops (admin/dispatcher) keep totals.
DROP FUNCTION IF EXISTS public.get_my_assigned_jobs(uuid);
CREATE FUNCTION public.get_my_assigned_jobs(p_profile_id uuid)
 RETURNS TABLE(assignment_id uuid, assignment_status text, job_id uuid, job_title text, job_description text, job_address text, job_status text, job_priority text, job_scheduled_for timestamp with time zone, customer_name text, customer_phone text, assignment_notes text, created_at timestamp with time zone, job_type text, job_quote_id uuid, deposit_invoice_id uuid, deposit_invoice_status text, deposit_invoice_paid_date timestamp with time zone, deposit_invoice_grand_total numeric, deposit_invoice_amount_paid numeric, deposit_invoice_remaining numeric, deposit_chip_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ops boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_profile_id THEN
    RAISE EXCEPTION 'Not authorized to read assigned jobs';
  END IF;
  v_ops := public.is_ops_user(auth.uid());

  RETURN QUERY
  SELECT
    a.id AS assignment_id,
    a.status::text AS assignment_status,
    j.id AS job_id,
    j.title::text AS job_title,
    j.description::text AS job_description,
    j.address::text AS job_address,
    j.status::text AS job_status,
    j.priority::text AS job_priority,
    j.scheduled_for AS job_scheduled_for,
    c.name::text AS customer_name,
    c.phone::text AS customer_phone,
    a.notes::text AS assignment_notes,
    a.created_at AS created_at,
    j.job_type::text AS job_type,
    j.quote_id AS job_quote_id,
    inv.id AS deposit_invoice_id,
    inv.status::text AS deposit_invoice_status,
    inv.paid_date::timestamptz AS deposit_invoice_paid_date,  -- cast: invoices.paid_date is DATE; the live function fails with 42804 without it
    CASE WHEN v_ops THEN inv.grand_total ELSE NULL END AS deposit_invoice_grand_total,
    CASE WHEN v_ops THEN COALESCE(pay.amount_paid, 0)::numeric ELSE NULL END AS deposit_invoice_amount_paid,
    GREATEST(COALESCE(inv.grand_total, 0) - COALESCE(pay.amount_paid, 0), 0)::numeric AS deposit_invoice_remaining,
    CASE WHEN inv.id IS NULL THEN NULL
         WHEN COALESCE(inv.grand_total, 0) > 0 AND GREATEST(COALESCE(inv.grand_total, 0) - COALESCE(pay.amount_paid, 0), 0) <= 0 THEN 'paid'
         WHEN COALESCE(pay.amount_paid, 0) > 0 AND GREATEST(COALESCE(inv.grand_total, 0) - COALESCE(pay.amount_paid, 0), 0) > 0 THEN 'partial'
         ELSE 'due' END AS deposit_chip_state
  FROM public.assignments a
  JOIN public.jobs j ON j.id = a.job_id
  LEFT JOIN public.customers c ON c.id = j.customer_id
  LEFT JOIN LATERAL (
    SELECT i.id, i.status, i.paid_date, i.grand_total
    FROM public.invoices i
    WHERE i.id = j.invoice_id
       OR (j.invoice_id IS NULL AND j.quote_id IS NOT NULL AND i.quote_id = j.quote_id)
    ORDER BY i.created_at ASC
    LIMIT 1
  ) inv ON TRUE
  LEFT JOIN LATERAL (
    SELECT public.invoice_amount_paid(inv.id) AS amount_paid
  ) pay ON inv.id IS NOT NULL
  WHERE a.profile_id = p_profile_id
  ORDER BY a.created_at DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_jobs(uuid) TO PUBLIC, anon, authenticated, service_role;