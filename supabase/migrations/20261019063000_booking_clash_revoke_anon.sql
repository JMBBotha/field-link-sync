-- Security fix (Johan 2026-10-19 06:26 SAST): booking_clashes / open_double_bookings were
-- executable by PUBLIC and anon (Supabase default privileges; 0002_calendar_clash_check only
-- GRANTed). booking_clashes skips its permission check when auth.uid() is NULL, so an anonymous
-- caller with a staff profile UUID could read that person's bookings (customer names, job/lead ids).
-- Keep authenticated + service_role (app, dispatch-job) and postgres (owner; _tech_claim_guard
-- trigger is SECURITY DEFINER owned by postgres, so it is unaffected).
REVOKE EXECUTE ON FUNCTION public.booking_clashes(uuid, date, time, time, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.open_double_bookings(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_clashes(uuid, date, time, time, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_double_bookings(date, date) TO authenticated, service_role;
