-- Minimum schema so 20261116220000_hangup_admin_followup.sql can be applied in PGlite.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE public.session_uid (uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT uid FROM public.session_uid LIMIT 1 $$;

CREATE TABLE public.companies (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid, full_name text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.company_settings (company_id uuid, sales_stage_limits jsonb);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  name text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  phone text,
  customer_address text,
  notes text,
  call_summary text,
  service_type text,
  status text DEFAULT 'pending',
  source text,
  primary_intent text,
  lead_status text DEFAULT 'new',
  created_at timestamptz DEFAULT now(),
  first_contact_at timestamptz,
  acknowledged_at timestamptz,
  deleted_at timestamptz,
  dismissed_at timestamptz,
  closed_at timestamptz,
  merged_into_id uuid,
  archived_at timestamptz,
  assigned_agent_id uuid,
  latitude numeric,
  longitude numeric
);

CREATE TABLE public.vapi_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  lead_id uuid,
  caller_phone text,
  duration_seconds integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.call_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid,
  lead_id uuid,
  company_id uuid,
  lead_level text,
  score integer,
  next_action text,
  status text DEFAULT 'done',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  type text,
  title text,
  body text,
  read boolean DEFAULT false,
  related_id uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.sales_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  entity_type text,
  entity_id uuid,
  stage text,
  level int,
  notified_user_ids uuid[],
  message text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_type, entity_id, stage, level)
);

CREATE FUNCTION public.caller_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1 $$;

CREATE FUNCTION public.has_role(uid uuid, role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = uid AND ur.role = has_role.role) $$;

CREATE FUNCTION public._hb_limit(p_company uuid, p_key text, p_default numeric) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (cs.sales_stage_limits->>p_key)::numeric FROM public.company_settings cs WHERE cs.company_id = p_company LIMIT 1), p_default)
$$;

CREATE FUNCTION public._hb_admins(p_company uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT pr.id), '{}')
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.id
   WHERE pr.company_id = p_company AND ur.role = 'admin'
$$;

CREATE FUNCTION public._hb_nudge(p_company uuid, p_type text, p_id uuid, p_stage text, p_level int, p_users uuid[], p_title text, p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid;
BEGIN
  INSERT INTO public.sales_escalations (company_id, entity_type, entity_id, stage, level, notified_user_ids, message)
  VALUES (p_company, p_type, p_id, p_stage, p_level, p_users, p_body);
  FOREACH u IN ARRAY p_users LOOP
    IF u IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
      VALUES (u, 'sales_nudge', p_title, p_body, p_id, jsonb_build_object('entity', p_type, 'stage', p_stage, 'level', p_level));
    END IF;
  END LOOP;
END $$;

-- Same hot-lead loop the migration patches. No business-hours gate, so the test does not depend on the clock.
CREATE FUNCTION public.process_sales_escalations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_now timestamptz := now();
BEGIN
  FOR r IN SELECT l.id, l.company_id, l.customer_name, l.assigned_agent_id, extract(epoch FROM v_now - l.created_at)/60 AS mins
    FROM public.leads l WHERE l.status = 'pending' AND l.first_contact_at IS NULL AND l.acknowledged_at IS NULL
      AND l.deleted_at IS NULL AND l.dismissed_at IS NULL AND l.closed_at IS NULL AND l.merged_into_id IS NULL AND l.primary_intent IS DISTINCT FROM 'service'
      AND l.created_at > v_now - interval '3 days' LOOP
    IF r.mins >= public._hb_limit(r.company_id,'leadRepMin',5) THEN
      PERFORM public._hb_nudge(r.company_id,'lead',r.id,'new',1, array[r.assigned_agent_id], 'Hot lead waiting', coalesce(r.customer_name,'New lead')||' not contacted yet');
    END IF;
  END LOOP;
END $$;
