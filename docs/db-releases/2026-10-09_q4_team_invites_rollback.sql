-- Rollback Q4 (the old app never calls it; the new app treats a missing function as "no redirect")
DROP FUNCTION IF EXISTS public.me_needs_password();
