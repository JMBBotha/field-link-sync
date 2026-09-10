-- Shared helper: settled cash applied to an invoice
CREATE OR REPLACE FUNCTION public.invoice_amount_paid(p_invoice_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(p.amount), 0)
    FROM public.payments p
   WHERE p.invoice_id = p_invoice_id
     AND (
       lower(p.status) IN ('completed', 'succeeded', 'paid')
       OR (p.status IS NULL AND p.gateway = 'manual')
     );
$function$;
REVOKE ALL ON FUNCTION public.invoice_amount_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_amount_paid(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_deposit_invoice_by_quote_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(inv)
  FROM (
    SELECT i.id, i.invoice_number, i.status, i.grand_total, i.paid_date, i.notes,
           public.invoice_amount_paid(i.id) AS amount_paid,
           GREATEST(COALESCE(i.grand_total, 0) - public.invoice_amount_paid(i.id), 0) AS remaining
    FROM public.quotes q
    JOIN public.invoices i ON i.quote_id = q.id
    WHERE q.public_token = p_token
    ORDER BY i.created_at ASC
    LIMIT 1
  ) inv;
$function$;

CREATE OR REPLACE FUNCTION public.get_invoice_aging_report()
 RETURNS TABLE(bracket text, invoice_count bigint, total_outstanding numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN CURRENT_DATE - i.due_date <= 30 THEN '0-30 days'
      WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60 days'
      WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90 days'
      ELSE '91+ days'
    END as bracket,
    COUNT(*)::bigint as invoice_count,
    SUM(i.grand_total - COALESCE(paid.total_paid, 0))::numeric as total_outstanding
  FROM invoices i
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) as total_paid
    FROM payments
    WHERE lower(status) IN ('completed', 'succeeded', 'paid')
       OR (status IS NULL AND gateway = 'manual')
    GROUP BY invoice_id
  ) paid ON paid.invoice_id = i.id
  WHERE i.status NOT IN ('paid', 'cancelled')
    AND i.due_date IS NOT NULL
  GROUP BY
    CASE
      WHEN CURRENT_DATE - i.due_date <= 30 THEN '0-30 days'
      WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60 days'
      WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90 days'
      ELSE '91+ days'
    END
  ORDER BY MIN(CURRENT_DATE - i.due_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_assigned_jobs(p_profile_id uuid)
 RETURNS TABLE(assignment_id uuid, assignment_status text, job_id uuid, job_title text, job_description text, job_address text, job_status text, job_priority text, job_scheduled_for timestamp with time zone, customer_name text, customer_phone text, assignment_notes text, created_at timestamp with time zone, job_type text, job_quote_id uuid, deposit_invoice_id uuid, deposit_invoice_status text, deposit_invoice_paid_date timestamp with time zone, deposit_invoice_grand_total numeric, deposit_invoice_amount_paid numeric, deposit_invoice_remaining numeric)
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
    SELECT public.invoice_amount_paid(inv.id) AS amount_paid
  ) pay ON inv.id IS NOT NULL
  WHERE a.profile_id = p_profile_id
  ORDER BY a.created_at DESC;
END;
$function$;