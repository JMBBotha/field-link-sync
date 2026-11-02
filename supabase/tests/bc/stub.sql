CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE TYPE request_type AS ENUM ('new_sale','service','move','admin');
CREATE TABLE company_members(id uuid default gen_random_uuid(), user_id uuid, company_id uuid, role text, is_owner boolean default false);
CREATE TABLE profiles(id uuid primary key, full_name text, dispatch_role text, availability_status text, archived_at timestamptz, dispatch_active boolean, home_lat float8, home_lng float8, home_base_lat numeric, home_base_lng numeric, skills text[]);
CREATE TABLE agent_locations(agent_id uuid, latitude numeric, longitude numeric, last_updated timestamptz);
CREATE TABLE customers(id uuid primary key, latitude numeric, longitude numeric, owner_rep_id uuid, assigned_rep_id uuid);
CREATE TABLE leads(id uuid primary key, latitude numeric, longitude numeric, job_types text[]);
CREATE TABLE requests(id uuid primary key default gen_random_uuid(), company_id uuid, source text default 'web', type request_type, status text default 'open', customer_id uuid, lead_id uuid, job_id uuid, customer_name text, phone text, area text, summary text, assigned_to uuid, assigned_at timestamptz, scheduled_for date, first_contact_at timestamptz, task_due_at timestamptz, created_at timestamptz, updated_at timestamptz);
CREATE TABLE notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text, read boolean, related_id uuid, created_at timestamptz default now(), metadata jsonb);
CREATE TABLE audit_log(id uuid default gen_random_uuid(), table_name text, record_id uuid, action text, old_data jsonb, new_data jsonb, user_id uuid, created_at timestamptz default now(), company_id uuid);
CREATE FUNCTION is_company_member(u uuid, c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT exists(select 1 from company_members where user_id=u and company_id=c) $$;
CREATE FUNCTION is_company_admin(u uuid, c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT exists(select 1 from company_members where user_id=u and company_id=c and role='admin') $$;
CREATE FUNCTION is_company_owner(u uuid, c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT exists(select 1 from company_members where user_id=u and company_id=c and is_owner) $$;
CREATE OR REPLACE FUNCTION public.fl_working_minutes(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS integer LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(sum(GREATEST(0, EXTRACT(epoch FROM (
           LEAST(p_to, ((d::date + time '17:00') AT TIME ZONE 'Africa/Johannesburg'))
         - GREATEST(p_from, ((d::date + time '08:00') AT TIME ZONE 'Africa/Johannesburg'))
         )) / 60))::int, 0)
  FROM generate_series((p_from AT TIME ZONE 'Africa/Johannesburg')::date, (p_to AT TIME ZONE 'Africa/Johannesburg')::date, interval '1 day') d
  WHERE p_to > p_from AND EXTRACT(isodow FROM d) < 6;
$function$;
CREATE OR REPLACE FUNCTION public.fl_request_contacted(r requests) RETURNS boolean LANGUAGE sql STABLE AS $function$
  SELECT r.first_contact_at IS NOT NULL OR r.source = 'manual' OR r.assigned_to IS NOT NULL OR r.job_id IS NOT NULL OR r.scheduled_for IS NOT NULL;
$function$;
