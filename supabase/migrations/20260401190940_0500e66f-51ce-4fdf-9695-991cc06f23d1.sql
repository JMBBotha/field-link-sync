
CREATE OR REPLACE FUNCTION public.auto_assign_independent_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.participant_type IN ('independent_sales', 'independent_tech') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'field_agent')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_independent_role ON public.profiles;
CREATE TRIGGER trg_auto_assign_independent_role
  AFTER INSERT OR UPDATE OF participant_type ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_independent_role();
