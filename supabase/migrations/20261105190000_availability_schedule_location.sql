-- Phase A: per-person weekly availability (GPS / Available window only) and
-- company-scoped reads of agent_locations.
--
-- This does NOT touch offer fitting. A person can be Available all day and
-- still be skipped for a slot they are already booked on. That stays in
-- _tech_offer_fit, _staff_slot_fit, _person_bookings and booking_clashes.
--
-- Safe to apply later: no existing rows are rewritten. Company defaults are
-- inserted only for Massair / the master company. A personal schedule is
-- created the first time that person opens the new app, and only for a
-- technician or salesperson.

CREATE TABLE IF NOT EXISTS public.company_availability_defaults (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  days smallint[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::smallint[],
  start_time time NOT NULL DEFAULT '07:00',
  end_time time NOT NULL DEFAULT '18:00',
  CONSTRAINT company_availability_days_ok CHECK (days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT company_availability_window_ok CHECK (end_time > start_time)
);

INSERT INTO public.company_availability_defaults (company_id)
SELECT c.id
  FROM public.companies c
 WHERE c.is_master IS TRUE
    OR c.id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
    OR c.name ILIKE '%massair%'
ON CONFLICT (company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.staff_availability_schedules (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  days smallint[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::smallint[],
  start_time time NOT NULL DEFAULT '07:00',
  end_time time NOT NULL DEFAULT '18:00',
  enabled boolean NOT NULL DEFAULT true,
  override_status text,
  override_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_availability_days_ok CHECK (days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CONSTRAINT staff_availability_window_ok CHECK (end_time > start_time),
  CONSTRAINT staff_availability_override_ok CHECK (override_status IS NULL OR override_status IN ('available', 'offline'))
);

ALTER TABLE public.company_availability_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_availability_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members read availability default" ON public.company_availability_defaults;
CREATE POLICY "Company members read availability default"
  ON public.company_availability_defaults FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

DROP POLICY IF EXISTS "Staff read own availability schedule" ON public.staff_availability_schedules;
CREATE POLICY "Staff read own availability schedule"
  ON public.staff_availability_schedules FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

-- Monday = 1 … Sunday = 7. End time is exclusive (18:00 is already Off).
CREATE OR REPLACE FUNCTION public.availability_in_window(
  p_days smallint[], p_start time, p_end time, p_tz text, p_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT EXTRACT(ISODOW FROM (p_at AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'Africa/Johannesburg')))::int = ANY (p_days)
     AND (p_at AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'Africa/Johannesburg'))::time >= p_start
     AND (p_at AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'Africa/Johannesburg'))::time < p_end;
$fn$;

CREATE OR REPLACE FUNCTION public.availability_next_boundary(
  p_days smallint[], p_start time, p_end time, p_tz text, p_at timestamptz DEFAULT now()
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $fn$
DECLARE
  v_tz text := COALESCE(NULLIF(p_tz, ''), 'Africa/Johannesburg');
  v_local timestamp;
  v_date date;
  v_time time;
  v_dow int;
  i int;
  v_d date;
BEGIN
  IF p_days IS NULL OR cardinality(p_days) = 0 THEN RETURN NULL; END IF;
  v_local := p_at AT TIME ZONE v_tz;
  v_date := v_local::date;
  v_time := v_local::time;
  v_dow := EXTRACT(ISODOW FROM v_local)::int;
  IF v_dow = ANY (p_days) AND v_time >= p_start AND v_time < p_end THEN
    RETURN (v_date + p_end) AT TIME ZONE v_tz;
  END IF;
  IF v_dow = ANY (p_days) AND v_time < p_start THEN
    RETURN (v_date + p_start) AT TIME ZONE v_tz;
  END IF;
  FOR i IN 1..7 LOOP
    v_d := v_date + i;
    IF EXTRACT(ISODOW FROM v_d)::int = ANY (p_days) THEN
      RETURN (v_d + p_start) AT TIME ZONE v_tz;
    END IF;
  END LOOP;
  RETURN NULL;
END $fn$;

CREATE OR REPLACE FUNCTION public._availability_staff(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT public.is_field_tech_only(p_uid) OR public.is_sales_rep(p_uid);
$fn$;

CREATE OR REPLACE FUNCTION public.my_availability_plan() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  s public.staff_availability_schedules%ROWTYPE;
  d public.company_availability_defaults%ROWTYPE;
  v_status text;
  v_track boolean;
  v_tz text := 'Africa/Johannesburg';
  v_days smallint[] := ARRAY[1, 2, 3, 4, 5]::smallint[];
  v_start time := '07:00';
  v_end time := '18:00';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(availability_status, 'offline'), COALESCE(location_tracking_enabled, false)
    INTO v_status, v_track FROM public.profiles WHERE id = v_uid;
  SELECT * INTO d FROM public.company_availability_defaults WHERE company_id = public.get_user_company_id(v_uid);
  IF FOUND THEN
    v_tz := d.timezone; v_days := d.days; v_start := d.start_time; v_end := d.end_time;
  END IF;
  SELECT * INTO s FROM public.staff_availability_schedules WHERE profile_id = v_uid;
  RETURN jsonb_build_object(
    'saved', FOUND,
    'status', v_status,
    'tracking_enabled', v_track,
    'suggestion', jsonb_build_object(
      'timezone', v_tz, 'days', to_jsonb(v_days),
      'start', to_char(v_start, 'HH24:MI'), 'end', to_char(v_end, 'HH24:MI')),
    'schedule', CASE WHEN NOT FOUND THEN NULL ELSE jsonb_build_object(
      'timezone', s.timezone, 'days', to_jsonb(s.days),
      'start', to_char(s.start_time, 'HH24:MI'), 'end', to_char(s.end_time, 'HH24:MI'),
      'enabled', s.enabled, 'override_status', s.override_status, 'override_until', s.override_until
    ) END,
    'in_window', CASE WHEN NOT FOUND THEN NULL
      ELSE public.availability_in_window(s.days, s.start_time, s.end_time, s.timezone, now()) END,
    'next_boundary', CASE WHEN NOT FOUND THEN NULL
      ELSE public.availability_next_boundary(s.days, s.start_time, s.end_time, s.timezone, now()) END
  );
END $fn$;

-- Copy the company suggestion onto this person once. Their later edits are never overwritten.
CREATE OR REPLACE FUNCTION public.ensure_my_availability_schedule() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF public._availability_staff(v_uid) THEN
    INSERT INTO public.staff_availability_schedules (profile_id, timezone, days, start_time, end_time, enabled)
    SELECT p.id, d.timezone, d.days, d.start_time, d.end_time, true
      FROM public.profiles p
      JOIN public.company_availability_defaults d ON d.company_id = p.company_id
     WHERE p.id = v_uid
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;
  RETURN public.my_availability_plan();
END $fn$;

CREATE OR REPLACE FUNCTION public.save_my_availability_schedule(
  p_days smallint[], p_start time, p_end time,
  p_timezone text DEFAULT 'Africa/Johannesburg', p_enabled boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tz text := COALESCE(NULLIF(btrim(p_timezone), ''), 'Africa/Johannesburg');
  v_days smallint[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public._availability_staff(v_uid) THEN
    RAISE EXCEPTION 'Availability hours are for technicians and sales' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL THEN RAISE EXCEPTION 'Pick the days you work'; END IF;
  SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), ARRAY[]::smallint[]) INTO v_days
    FROM unnest(p_days) AS d;
  IF EXISTS (SELECT 1 FROM unnest(v_days) d WHERE d < 1 OR d > 7) THEN
    RAISE EXCEPTION 'Days must be Monday (1) through Sunday (7)';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    RAISE EXCEPTION 'Unknown timezone %', v_tz;
  END IF;
  INSERT INTO public.staff_availability_schedules
    (profile_id, timezone, days, start_time, end_time, enabled, override_status, override_until, updated_at)
  VALUES (v_uid, v_tz, v_days, p_start, p_end, COALESCE(p_enabled, true), NULL, NULL, now())
  ON CONFLICT (profile_id) DO UPDATE SET
    timezone = EXCLUDED.timezone, days = EXCLUDED.days, start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time, enabled = EXCLUDED.enabled,
    override_status = NULL, override_until = NULL, updated_at = now();
  PERFORM public.apply_my_availability_schedule();
  RETURN public.my_availability_plan();
END $fn$;

-- Busy (on a job) is left alone. Otherwise the window, or a manual hold until
-- the next boundary, becomes profiles.availability_status. availability_choice
-- is not touched, so finishing a job still restores the last deliberate choice
-- and this function then applies the window again.
CREATE OR REPLACE FUNCTION public.apply_my_availability_schedule() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  s public.staff_availability_schedules%ROWTYPE;
  v_desired text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(availability_status, 'offline') INTO v_status FROM public.profiles WHERE id = v_uid;
  IF v_status = 'busy' OR NOT public._availability_staff(v_uid) THEN RETURN v_status; END IF;
  SELECT * INTO s FROM public.staff_availability_schedules WHERE profile_id = v_uid;
  IF NOT FOUND THEN RETURN v_status; END IF;
  IF NOT s.enabled THEN RETURN v_status; END IF;
  IF s.override_status IN ('available', 'offline') AND (s.override_until IS NULL OR s.override_until > now()) THEN
    v_desired := s.override_status;
  ELSE
    IF s.override_status IS NOT NULL THEN
      UPDATE public.staff_availability_schedules
         SET override_status = NULL, override_until = NULL, updated_at = now()
       WHERE profile_id = v_uid;
    END IF;
    v_desired := CASE
      WHEN public.availability_in_window(s.days, s.start_time, s.end_time, s.timezone, now()) THEN 'available'
      ELSE 'offline' END;
  END IF;
  IF v_desired IS DISTINCT FROM v_status THEN
    UPDATE public.profiles
       SET availability_status = v_desired, last_availability_update = now()
     WHERE id = v_uid;
  END IF;
  RETURN v_desired;
END $fn$;

-- Same contract as before, plus a manual Available / Off remembered until the
-- next window boundary when this person has a schedule.
CREATE OR REPLACE FUNCTION public.set_my_availability(p_status text, p_manual boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_new text; s public.staff_availability_schedules%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status = 'restore' THEN
    SELECT COALESCE(availability_choice, 'available') INTO v_new FROM public.profiles WHERE id = v_uid;
    UPDATE public.profiles SET availability_status = v_new, last_availability_update = now() WHERE id = v_uid;
    RETURN public.apply_my_availability_schedule();
  ELSIF p_status IN ('available', 'busy', 'offline') THEN v_new := p_status;
  ELSE RAISE EXCEPTION 'bad status %', p_status; END IF;
  UPDATE public.profiles SET availability_status = v_new, last_availability_update = now(),
         availability_choice = CASE WHEN p_manual AND p_status <> 'restore' THEN v_new ELSE availability_choice END
   WHERE id = v_uid;
  IF p_manual AND v_new IN ('available', 'offline') THEN
    SELECT * INTO s FROM public.staff_availability_schedules WHERE profile_id = v_uid AND enabled;
    IF FOUND THEN
      UPDATE public.staff_availability_schedules
         SET override_status = v_new,
             override_until = public.availability_next_boundary(s.days, s.start_time, s.end_time, s.timezone, now()),
             updated_at = now()
       WHERE profile_id = v_uid;
    END IF;
  END IF;
  RETURN v_new;
END $fn$;

-- Direct client writes of a new coordinate are refused unless this person is
-- opted in AND Available. Mirroring is_available (no coordinate change) still
-- works. INVOKER is required: current_user is then `authenticated` for a
-- PostgREST upsert, and the owner (not authenticated) when a SECURITY DEFINER
-- presence/trip function writes the same table. Do not mark this DEFINER or
-- the check below always sees the owner and never gates the client.
CREATE OR REPLACE FUNCTION public._guard_agent_location_share() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $fn$
DECLARE v_track boolean; v_status text; v_moved boolean;
BEGIN
  v_moved := TG_OP = 'INSERT'
    OR NEW.latitude IS DISTINCT FROM OLD.latitude
    OR NEW.longitude IS DISTINCT FROM OLD.longitude
    OR NEW.last_updated IS DISTINCT FROM OLD.last_updated;
  IF NOT v_moved THEN RETURN NEW; END IF;
  IF current_user IS DISTINCT FROM 'authenticated' THEN RETURN NEW; END IF;
  SELECT COALESCE(location_tracking_enabled, false), COALESCE(availability_status, 'offline')
    INTO v_track, v_status FROM public.profiles WHERE id = NEW.agent_id;
  IF NOT v_track OR v_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'location share is off' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_guard_agent_location_share ON public.agent_locations;
CREATE TRIGGER trg_guard_agent_location_share
  BEFORE INSERT OR UPDATE ON public.agent_locations
  FOR EACH ROW EXECUTE FUNCTION public._guard_agent_location_share();

-- Applies the window first, then writes a ping only if sharing is still on.
CREATE OR REPLACE FUNCTION public.record_my_location_ping(p_lat numeric, p_lng numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_track boolean; v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'signed_out'); END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_location'); END IF;
  PERFORM public.apply_my_availability_schedule();
  SELECT COALESCE(location_tracking_enabled, false), COALESCE(availability_status, 'offline')
    INTO v_track, v_status FROM public.profiles WHERE id = v_uid;
  IF NOT v_track OR v_status IS DISTINCT FROM 'available' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_sharing');
  END IF;
  INSERT INTO public.agent_locations (agent_id, latitude, longitude, is_available, last_updated)
  VALUES (v_uid, p_lat, p_lng, true, now())
  ON CONFLICT (agent_id) DO UPDATE
    SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, last_updated = EXCLUDED.last_updated;
  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE ALL ON FUNCTION public.availability_in_window(smallint[], time, time, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.availability_next_boundary(smallint[], time, time, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._availability_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_availability_plan() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_my_availability_schedule() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_availability_schedule(smallint[], time, time, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_my_availability_schedule() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_my_location_ping(numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._guard_agent_location_share() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_availability_plan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_availability_schedule() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_availability_schedule(smallint[], time, time, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_my_availability_schedule() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_my_location_ping(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_availability(text, boolean) TO authenticated;

-- Live Map: admins and office ops see their own company's staff only.
-- Sales reps do not see peers. Job ETA stays on job_tech_location (definer).
DROP POLICY IF EXISTS "Admins can view all agent locations" ON public.agent_locations;
DROP POLICY IF EXISTS "Company ops can view staff locations" ON public.agent_locations;
CREATE POLICY "Company ops can view staff locations"
  ON public.agent_locations FOR SELECT TO authenticated
  USING (
    public.is_ops_user(auth.uid())
    AND NOT public.is_sales_rep(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles them
       WHERE them.id = agent_locations.agent_id
         AND them.company_id IS NOT NULL
         AND them.company_id = public.get_user_company_id(auth.uid())
    )
  );
