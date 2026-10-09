-- Q4b (2026-10-09): Team invites apply when the invitee CONFIRMS their email (proves inbox ownership),
-- not on "empty password" (GoTrue now stores a random hash for magic-link users, so invites never applied).
-- The Set-password redirect keys off the same signal: an accepted invite whose password hasn't been set yet.
ALTER TABLE public.team_invites ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

CREATE OR REPLACE FUNCTION public.apply_team_invite(p_user uuid, p_email text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v public.team_invites%ROWTYPE; v_co uuid;
BEGIN
  IF p_user IS NULL OR p_email IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v FROM public.team_invites WHERE email = lower(p_email) AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF v.id IS NULL THEN RETURN NULL; END IF;
  SELECT company_id INTO v_co FROM public.profiles WHERE id = p_user;
  IF v_co IS NOT NULL AND v_co IS DISTINCT FROM v.company_id THEN RETURN NULL; END IF; -- already in another company: leave pending
  INSERT INTO public.profiles (id, full_name, company_id, dispatch_role)
  VALUES (p_user, split_part(p_email, '@', 1), v.company_id, v.dispatch_role)
  ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id,
    dispatch_role = COALESCE(EXCLUDED.dispatch_role, public.profiles.dispatch_role);
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user, v.role) ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.company_members (user_id, company_id, role)
  VALUES (p_user, v.company_id, CASE WHEN v.role = 'admin' THEN 'admin' ELSE 'member' END)
  ON CONFLICT (user_id, company_id) DO NOTHING;
  UPDATE public.team_invites SET accepted_at = now(), accepted_user_id = p_user WHERE id = v.id;
  RETURN v.id;
END $f$;
REVOKE ALL ON FUNCTION public.apply_team_invite(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.auth_user_invite_events()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  BEGIN
    IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
      PERFORM public.apply_team_invite(NEW.id, NEW.email);
    END IF;
    IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
      UPDATE public.team_invites SET password_set_at = now() WHERE accepted_user_id = NEW.id AND password_set_at IS NULL;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'team invite step skipped for %: %', NEW.id, SQLERRM; -- never block sign-in/confirmation
  END;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.auth_user_invite_events() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_invite_events ON auth.users;
CREATE TRIGGER on_auth_user_invite_events AFTER UPDATE OF email_confirmed_at, encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auth_user_invite_events();

-- handle_new_user: apply an invite at creation only if the account is created already confirmed.
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  IF position('NEW.email_confirmed_at IS NOT NULL /*q4b*/' in d) = 0 THEN
    d := replace(d, 'IF COALESCE(NEW.encrypted_password, '''') = '''' THEN', 'IF NEW.email_confirmed_at IS NOT NULL /*q4b*/ THEN');
    IF position('/*q4b*/' in d) = 0 THEN RAISE EXCEPTION 'handle_new_user anchor not found'; END IF;
    EXECUTE d;
  END IF;
END $$;

-- Redirect signal = accepted invite without a password set since.
CREATE OR REPLACE FUNCTION public.me_needs_password()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_invites i WHERE i.accepted_user_id = auth.uid() AND i.password_set_at IS NULL);
$f$;
REVOKE ALL ON FUNCTION public.me_needs_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.me_needs_password() TO authenticated;
