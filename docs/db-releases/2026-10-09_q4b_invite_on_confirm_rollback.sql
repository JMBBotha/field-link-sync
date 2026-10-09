-- Rollback Q4b (back to the Q4 state)
DROP TRIGGER IF EXISTS on_auth_user_invite_events ON auth.users;
DROP FUNCTION IF EXISTS public.auth_user_invite_events();
DROP FUNCTION IF EXISTS public.apply_team_invite(uuid, text);
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  IF position('/*q4b*/' in d) > 0 THEN
    EXECUTE replace(d, 'IF NEW.email_confirmed_at IS NOT NULL /*q4b*/ THEN', 'IF COALESCE(NEW.encrypted_password, '''') = '''' THEN');
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.me_needs_password()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT COALESCE((SELECT COALESCE(u.encrypted_password, '') = '' FROM auth.users u WHERE u.id = auth.uid()), false);
$f$;
REVOKE ALL ON FUNCTION public.me_needs_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.me_needs_password() TO authenticated;
-- password_set_at is left in place (harmless, nullable); drop only if wanted:
-- ALTER TABLE public.team_invites DROP COLUMN IF EXISTS password_set_at;
