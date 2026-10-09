-- P1 My visits (2026-10-09)
DROP FUNCTION IF EXISTS public.get_my_visits(integer);
CREATE FUNCTION public.get_my_visits(p_days integer DEFAULT 60)
 RETURNS TABLE(lead_id uuid, customer_id uuid, customer_name text, phone text, address text, lat numeric, lng numeric,
   scheduled_date date, scheduled_time time without time zone, status text, primary_intent text, is_mine boolean, notes text,
   quote_id uuid, quote_number text, quote_status text, quote_total numeric, quote_accepted boolean, has_install_job boolean,
   offer_km numeric, offer_label text)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $f$
  WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
  rep AS (SELECT public.is_sales_rep(auth.uid()) AS is_rep),
  offers AS (SELECT o.lead_id, o.km, o.label FROM public.rep_offerable_leads() o)  -- lead filtering (needs that release)
  SELECT l.id, l.customer_id, l.customer_name, COALESCE(NULLIF(l.customer_phone, ''), l.phone),
         COALESCE(NULLIF(l.customer_address, ''), l.normalized_address), l.latitude, l.longitude,
         l.scheduled_date, l.scheduled_time, l.status, l.primary_intent::text,
         COALESCE(auth.uid() IN (l.assigned_agent_id, l.created_by), false) AS is_mine, l.notes,
         q.id, q.quote_number, q.status, q.total,
         EXISTS (SELECT 1 FROM public.quotes qa WHERE qa.lead_id = l.id AND qa.status = 'accepted'),
         EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = l.id AND j.job_type = 'installation'),
         o.km, o.label
    FROM public.leads l CROSS JOIN today CROSS JOIN rep
    LEFT JOIN offers o ON o.lead_id = l.id
    LEFT JOIN LATERAL (SELECT q1.id, q1.quote_number, q1.status, q1.total FROM public.quotes q1
                        WHERE q1.lead_id = l.id ORDER BY q1.created_at DESC LIMIT 1) q ON true
   WHERE l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND l.company_id = public.get_user_company_id(auth.uid())
     AND (COALESCE(auth.uid() IN (l.assigned_agent_id, l.created_by), false)
          OR (l.assigned_agent_id IS NULL AND l.status = 'pending' AND COALESCE(l.primary_intent::text, 'sales') = 'sales'
              AND (NOT rep.is_rep OR o.lead_id IS NOT NULL)))
     AND (l.scheduled_date IS NULL OR l.scheduled_date BETWEEN today.d - 30 AND today.d + GREATEST(COALESCE(p_days, 60), 0))
   ORDER BY l.scheduled_date NULLS LAST, l.scheduled_time NULLS LAST, l.customer_name;
$f$;
REVOKE ALL ON FUNCTION public.get_my_visits(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_visits(integer) TO authenticated;

-- get_my_appointments: for sales reps, unassigned leads are sales-lane only
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_my_appointments(integer)'::regprocedure);
  IF position('/*p1lane*/' in d) = 0 THEN
    d := replace(d, 'OR (l.assigned_agent_id IS NULL AND l.status = ''pending''))',
      'OR (l.assigned_agent_id IS NULL AND l.status = ''pending'' /*p1lane*/ AND (NOT public.is_sales_rep(auth.uid()) OR COALESCE(l.primary_intent::text, ''sales'') = ''sales'')))');
    IF position('/*p1lane*/' in d) = 0 THEN RAISE EXCEPTION 'anchor not found'; END IF;
    EXECUTE d;
  END IF;
END $$;
