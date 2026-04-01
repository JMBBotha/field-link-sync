CREATE OR REPLACE FUNCTION public.get_my_assigned_jobs(p_profile_id uuid)
RETURNS TABLE (
  assignment_id uuid,
  assignment_status text,
  job_id uuid,
  job_title text,
  job_description text,
  job_address text,
  job_status text,
  job_priority text,
  job_scheduled_for timestamptz,
  customer_name text,
  customer_phone text,
  assignment_notes text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    a.created_at AS created_at
  FROM public.assignments a
  JOIN public.jobs j ON j.id = a.job_id
  LEFT JOIN public.customers c ON c.id = j.customer_id
  WHERE a.profile_id = p_profile_id
  ORDER BY a.created_at DESC;
END;
$$;