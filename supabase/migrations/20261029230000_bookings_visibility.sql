-- Bookings (open leads, scheduled or assigned, no job yet) for the client page and the pipeline,
-- using the same visibility as #57: office = whole company; sales rep = rep_follows_lead (incl. owner-rep).
CREATE OR REPLACE FUNCTION public._fl_open_leads_visible(p_customer uuid)
RETURNS TABLE (id uuid, customer_id uuid, customer_name text, address text, intent text, service_type text, source text,
  created_at timestamptz, first_contact_at timestamptz, scheduled_date date, scheduled_time time, assigned_to uuid, assigned_name text, has_quote boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT auth.uid() AS uid, public.get_user_company_id(auth.uid()) AS co)
  SELECT l.id, l.customer_id, COALESCE(c.name, l.customer_name), l.customer_address, l.primary_intent::text, l.service_type, l.source,
         l.created_at, l.first_contact_at, l.scheduled_date, l.scheduled_time, l.assigned_agent_id, NULLIF(trim(p.full_name), ''),
         EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id AND q.status <> 'superseded')
    FROM public.leads l CROSS JOIN me
    LEFT JOIN public.customers c ON c.id = l.customer_id
    LEFT JOIN public.profiles p ON p.id = l.assigned_agent_id
   WHERE me.uid IS NOT NULL AND l.company_id = me.co AND l.deleted_at IS NULL AND l.merged_into_id IS NULL AND l.status = 'pending'
     AND (p_customer IS NULL OR l.customer_id = p_customer)
     AND (public.fl_is_company_office(me.uid, me.co) OR (public.is_sales_rep(me.uid) AND public.rep_follows_lead(me.uid, l.id)))
   ORDER BY l.scheduled_date NULLS LAST, l.scheduled_time NULLS LAST, l.created_at DESC
   LIMIT 500;
$$;
REVOKE ALL ON FUNCTION public._fl_open_leads_visible(uuid) FROM PUBLIC, anon;
CREATE OR REPLACE FUNCTION public.client_bookings(p_customer uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT to_jsonb(x) FROM public._fl_open_leads_visible(p_customer) x WHERE p_customer IS NOT NULL; $$;
CREATE OR REPLACE FUNCTION public.pipeline_open_leads() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT to_jsonb(x) FROM public._fl_open_leads_visible(NULL) x; $$;
GRANT EXECUTE ON FUNCTION public.client_bookings(uuid), public.pipeline_open_leads() TO authenticated;
GRANT EXECUTE ON FUNCTION public._fl_open_leads_visible(uuid) TO authenticated;
