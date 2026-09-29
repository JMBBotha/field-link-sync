REVOKE ALL ON FUNCTION public.is_office_staff(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_office_staff(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fill_used_part_cost() FROM anon, authenticated, public;