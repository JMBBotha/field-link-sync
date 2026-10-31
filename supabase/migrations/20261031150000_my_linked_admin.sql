-- Sales home flow (Johan 31 Oct, t2010u): a sales login linked to an admin account sees company-wide numbers.
-- Read-only helper: the admin account this login is linked to (rep_linked_admin), same company only, else NULL.
CREATE OR REPLACE FUNCTION public.my_linked_admin()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.admin_user_id FROM public.rep_linked_admin r
   WHERE r.rep_user_id = auth.uid() AND r.company_id = public.caller_company_id()
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_linked_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_linked_admin() TO authenticated;
