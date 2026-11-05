-- Rollback for 20261105190000_availability_schedule_location.sql
-- Restores the previous cross-company admin SELECT on agent_locations and
-- the previous set_my_availability. Does not delete location history.

DROP TRIGGER IF EXISTS trg_guard_agent_location_share ON public.agent_locations;
DROP FUNCTION IF EXISTS public._guard_agent_location_share();
DROP FUNCTION IF EXISTS public.record_my_location_ping(numeric, numeric);
DROP FUNCTION IF EXISTS public.save_my_availability_schedule(smallint[], time, time, text, boolean);
DROP FUNCTION IF EXISTS public.ensure_my_availability_schedule();
DROP FUNCTION IF EXISTS public.apply_my_availability_schedule();
DROP FUNCTION IF EXISTS public.my_availability_plan();
DROP FUNCTION IF EXISTS public._availability_staff(uuid);
DROP FUNCTION IF EXISTS public.availability_next_boundary(smallint[], time, time, text, timestamptz);
DROP FUNCTION IF EXISTS public.availability_in_window(smallint[], time, time, text, timestamptz);

DROP POLICY IF EXISTS "Company ops can view staff locations" ON public.agent_locations;
DROP POLICY IF EXISTS "Admins can view all agent locations" ON public.agent_locations;
CREATE POLICY "Admins can view all agent locations"
  ON public.agent_locations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_my_availability(p_status text, p_manual boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_new text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status = 'restore' THEN
    SELECT COALESCE(availability_choice, 'available') INTO v_new FROM public.profiles WHERE id = v_uid;
  ELSIF p_status IN ('available', 'busy', 'offline') THEN v_new := p_status;
  ELSE RAISE EXCEPTION 'bad status %', p_status; END IF;
  UPDATE public.profiles SET availability_status = v_new, last_availability_update = now(),
         availability_choice = CASE WHEN p_manual AND p_status <> 'restore' THEN v_new ELSE availability_choice END
   WHERE id = v_uid;
  RETURN v_new;
END $fn$;
GRANT EXECUTE ON FUNCTION public.set_my_availability(text, boolean) TO authenticated;

DROP TABLE IF EXISTS public.staff_availability_schedules;
DROP TABLE IF EXISTS public.company_availability_defaults;
