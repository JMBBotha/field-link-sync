-- Linked-admin scope (Johan 31 Oct, t2022u/t2023u, audit #1): a sales login linked to an admin account works company-wide.
-- is_sales_rep() is NOT changed globally; this helper is the one shared SQL rule for "own records only".
CREATE OR REPLACE FUNCTION public.sales_scope_own(p_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.is_sales_rep(p_uid)
     AND NOT EXISTS (SELECT 1 FROM public.rep_linked_admin r
                      WHERE r.rep_user_id = p_uid AND r.company_id = public.get_user_company_id(p_uid))
$$;
REVOKE ALL ON FUNCTION public.sales_scope_own(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_scope_own(uuid) TO authenticated;

-- sales_next_steps: swap the scope test only (body otherwise unchanged).
DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.sales_next_steps(uuid)'::regprocedure) INTO d;
  IF position('v_is_rep := public.is_sales_rep(v_uid);' in d) > 0 THEN
    EXECUTE replace(d, 'v_is_rep := public.is_sales_rep(v_uid);', 'v_is_rep := public.sales_scope_own(v_uid);');
  END IF;
END $mig$;
