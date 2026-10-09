-- Q4 (2026-10-09): Team invites. An invitee who signs in by magic link but lands anywhere other than
-- /set-password (e.g. redirect URL not on the auth allow-list) is sent to /set-password by the app.
-- Read-only, caller-only: tells the signed-in user whether their own account still has no password.
CREATE OR REPLACE FUNCTION public.me_needs_password()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT COALESCE((SELECT COALESCE(u.encrypted_password, '') = '' FROM auth.users u WHERE u.id = auth.uid()), false);
$f$;
REVOKE ALL ON FUNCTION public.me_needs_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.me_needs_password() TO authenticated;
