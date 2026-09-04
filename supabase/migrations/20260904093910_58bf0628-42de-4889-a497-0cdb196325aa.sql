-- 1) Extend get_my_assigned_jobs with job_quote_id (return type changes → drop + recreate)
DROP FUNCTION IF EXISTS public.get_my_assigned_jobs(uuid);

CREATE OR REPLACE FUNCTION public.get_my_assigned_jobs(p_profile_id uuid)
RETURNS TABLE(
  assignment_id uuid, assignment_status text, job_id uuid, job_title text,
  job_description text, job_address text, job_status text, job_priority text,
  job_scheduled_for timestamptz, customer_name text, customer_phone text,
  assignment_notes text, created_at timestamptz, job_type text,
  job_quote_id uuid,
  deposit_invoice_id uuid, deposit_invoice_status text,
  deposit_invoice_paid_date timestamptz, deposit_invoice_grand_total numeric,
  deposit_invoice_amount_paid numeric, deposit_invoice_remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_profile_id THEN
    RAISE EXCEPTION 'Not authorized to read assigned jobs';
  END IF;

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
    inv.paid_date AS deposit_invoice_paid_date,
    inv.grand_total AS deposit_invoice_grand_total,
    COALESCE(pay.amount_paid, 0)::numeric AS deposit_invoice_amount_paid,
    GREATEST(COALESCE(inv.grand_total, 0) - COALESCE(pay.amount_paid, 0), 0)::numeric AS deposit_invoice_remaining
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
    SELECT COALESCE(SUM(p.amount), 0) AS amount_paid
    FROM public.payments p
    WHERE p.invoice_id = inv.id AND p.status = 'paid'
  ) pay ON inv.id IS NOT NULL
  WHERE a.profile_id = p_profile_id
  ORDER BY a.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_assigned_jobs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_jobs(uuid) TO service_role;

-- 2) Light quote summary for the job detail "Quote / Build path" card
CREATE OR REPLACE FUNCTION public.get_quote_summary(p_quote_id uuid)
RETURNS TABLE(id uuid, quote_number text, status text, total numeric, customer_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT q.id, q.quote_number::text, q.status::text, q.total, c.name::text AS customer_name
  FROM public.quotes q
  LEFT JOIN public.customers c ON c.id = q.customer_id
  WHERE q.id = p_quote_id
    AND (
      q.company_id = public.get_user_company_id(auth.uid())
      OR public.is_ops_user(auth.uid())
      OR q.sales_engineer_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.assignments a ON a.job_id = j.id
        WHERE j.quote_id = q.id AND a.profile_id = auth.uid()
      )
    )
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_quote_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_quote_summary(uuid) TO service_role;