REVOKE EXECUTE ON FUNCTION public.can_read_specials(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_specials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_specials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_specials(uuid) TO authenticated;