DROP FUNCTION IF EXISTS public.get_my_assigned_jobs(uuid);

CREATE OR REPLACE FUNCTION public.get_my_assigned_jobs(p_profile_id uuid)
RETURNS TABLE(
  assignment_id uuid,
  assignment_status text,
  job_id uuid,
  job_title text,
  job_description text,
  job_address text,
  job_status text,
  job_priority text,
  job_scheduled_for timestamp with time zone,
  customer_name text,
  customer_phone text,
  assignment_notes text,
  created_at timestamp with time zone,
  job_type text,
  deposit_invoice_id uuid,
  deposit_invoice_status text,
  deposit_invoice_paid_date timestamp with time zone,
  deposit_invoice_grand_total numeric
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
    inv.id AS deposit_invoice_id,
    inv.status::text AS deposit_invoice_status,
    inv.paid_date AS deposit_invoice_paid_date,
    inv.grand_total AS deposit_invoice_grand_total
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
  WHERE a.profile_id = p_profile_id
  ORDER BY a.created_at DESC;
END;
$function$;