-- Minimal stand-in so the sales-rep technician migration can run in memory.
-- Not the live schema. No production data.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.me (uid uuid);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT uid FROM auth.me LIMIT 1 $$;

DO $$ BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'dispatcher', 'field_agent', 'viewer', 'platform_super_admin', 'platform_ops');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  office_lat double precision,
  office_lng double precision
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  company_id uuid,
  dispatch_role text,
  participant_type text,
  dispatch_active boolean DEFAULT true,
  archived_at timestamptz,
  no_login boolean DEFAULT false,
  network_status text,
  start_from text,
  home_lat double precision,
  home_lng double precision,
  office_lat double precision,
  office_lng double precision,
  availability_status text,
  home_base_lat double precision,
  home_base_lng double precision,
  home_base_lat_unused double precision,
  workshop_lat double precision,
  workshop_lng double precision
);

CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  company_id uuid,
  role text
);

CREATE TABLE public.user_roles (
  user_id uuid,
  role text
);

CREATE TABLE public.agent_affiliations (
  profile_id uuid,
  company_id uuid,
  status text,
  affiliation_type text,
  listed_as_staff boolean
);

CREATE TABLE public.staff_home_bases (
  profile_id uuid,
  lat double precision,
  lng double precision,
  address text
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  latitude double precision,
  longitude double precision,
  city text
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  company_id uuid,
  deleted_at timestamptz,
  merged_into_id uuid,
  created_by uuid,
  assigned_agent_id uuid,
  customer_name text,
  customer_address text,
  customer_id uuid,
  service_type text,
  primary_intent text,
  scheduled_date date,
  scheduled_time time,
  estimated_duration_minutes int,
  job_types text[],
  job_info text,
  latitude double precision,
  longitude double precision,
  assignment_method text
);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY,
  company_id uuid,
  created_by uuid,
  customer_id uuid,
  lat double precision,
  lng double precision,
  scheduled_for timestamptz,
  status text
);

CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  profile_id uuid,
  status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.job_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  job_id uuid,
  agent_id uuid,
  scheduled_date date,
  start_time time,
  end_time time,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.agent_locations (
  agent_id uuid,
  latitude double precision,
  longitude double precision,
  last_updated timestamptz
);

CREATE TABLE public.lead_assignment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  company_id uuid,
  tech_id uuid,
  previous_agent_id uuid,
  assigned_by uuid,
  by_role text,
  scheduled_date date,
  start_time time,
  end_time time,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.lead_reassign_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  company_id uuid,
  requested_by uuid,
  preferred_tech_id uuid,
  reason text,
  status text DEFAULT 'pending',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = _role::text);
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = _uid AND m.company_id = _company);
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = _uid AND m.company_id = _company AND m.role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.fl_is_company_admin(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _uid AND r.role = 'admin' AND p.company_id = _company
  );
$$;

CREATE OR REPLACE FUNCTION public.is_sales_rep(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.dispatch_role IN ('sales', 'sales_engineer'))
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'dispatcher')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin', 'platform_super_admin', 'platform_ops'));
$$;

CREATE OR REPLACE FUNCTION public.get_user_company_id(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT company_id FROM public.profiles WHERE id = _uid;
$$;

CREATE OR REPLACE FUNCTION public.caller_company_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT public.get_user_company_id(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_ops_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin', 'dispatcher'))
    AND NOT public.is_sales_rep(_uid);
$$;

CREATE OR REPLACE FUNCTION public.staff_is_available(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.rep_booked_or_assigned_job(_uid uuid, _job uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job AND j.created_by = _uid);
$$;

CREATE OR REPLACE FUNCTION public.rep_booked_or_assigned_lead(_uid uuid, _lead uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND (l.created_by = _uid OR l.assigned_agent_id = _uid));
$$;

CREATE OR REPLACE FUNCTION public._lead_office(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.fl_is_company_admin(_uid, _company);
$$;

CREATE OR REPLACE FUNCTION public._company_tech_ok(_tech uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _tech
      AND p.company_id = _company
      AND p.archived_at IS NULL
      AND (p.dispatch_role = 'technician' OR p.participant_type = 'independent_tech')
  );
$$;

CREATE OR REPLACE FUNCTION public._km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::numeric $$;

CREATE OR REPLACE FUNCTION public.staff_work_window(_uid uuid, _date date)
RETURNS TABLE(start_time time, end_time time, is_working boolean, source text)
LANGUAGE sql STABLE AS $$
  SELECT '08:00'::time, '17:00'::time, false, 'off'::text;
$$;

CREATE OR REPLACE FUNCTION public._person_bookings(_uid uuid, _date date)
RETURNS TABLE(start_time time, end_time time, job_id uuid, lead_id uuid, customer_name text)
LANGUAGE sql STABLE AS $$
  SELECT NULL::time, NULL::time, NULL::uuid, NULL::uuid, NULL::text WHERE false;
$$;

CREATE OR REPLACE FUNCTION public.calculate_distance_km(a numeric, b numeric, c double precision, d double precision)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 1::numeric $$;

CREATE OR REPLACE FUNCTION public._mins_time(_m int)
RETURNS time LANGUAGE sql IMMUTABLE AS $$ SELECT '08:00'::time $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_test_read ON public.profiles;
CREATE POLICY profiles_test_read ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS schedules_test_read ON public.job_schedules;
CREATE POLICY schedules_test_read ON public.job_schedules FOR SELECT TO authenticated USING (true);

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON auth.me TO authenticated;
GRANT SELECT ON public.profiles, public.job_schedules, public.companies, public.leads, public.jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_reassign_requests, public.lead_assignment_log TO authenticated;
