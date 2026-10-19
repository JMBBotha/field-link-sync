-- Rollback (restores the previous, LEAKY ACL; only use if something essential breaks)
GRANT EXECUTE ON FUNCTION public.booking_clashes(uuid, date, time, time, uuid, uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_double_bookings(date, date) TO PUBLIC, anon;
