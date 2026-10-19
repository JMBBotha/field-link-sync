-- Applied live 2026-10-19 (see supabase/migrations/20261019063000_booking_clash_revoke_anon.sql)
REVOKE EXECUTE ON FUNCTION public.booking_clashes(uuid, date, time, time, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_double_bookings(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_clashes(uuid, date, time, time, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_double_bookings(date, date) TO authenticated, service_role;
