-- P7 network performance roll-up (master company admins only) + company names for the network card (2026-10-09)
CREATE OR REPLACE FUNCTION public.p7_is_master_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.p4_is_platform() OR (public.has_role(auth.uid(),'admin'::app_role) AND public.is_master_company_user(auth.uid())) $$;

-- names only (no settings/pricing) so the master can see and approve network companies
CREATE OR REPLACE FUNCTION public.network_company_names()
RETURNS TABLE(id uuid, name text, is_master boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.p7_is_master_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT c.id, c.name, c.is_master FROM public.companies c WHERE c.status = 'active' ORDER BY c.is_master DESC, c.name;
END $$;

-- per-company totals for the master and its approved network members; counts + accepted quote value, no customer data
CREATE OR REPLACE FUNCTION public.network_performance(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days,30), 366))); v_out jsonb;
BEGIN
  IF NOT public.p7_is_master_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  WITH cos AS (
    SELECT c.id, c.name, c.is_master FROM public.companies c
    WHERE c.is_master OR EXISTS (SELECT 1 FROM public.company_network_members m JOIN public.companies mc ON mc.id=m.master_company_id AND mc.is_master
                                 WHERE m.member_company_id=c.id AND m.status='approved')),
  agg AS (
    SELECT cos.id, cos.name, cos.is_master,
      (SELECT count(*) FROM public.leads l WHERE l.company_id=cos.id AND l.created_at >= v_from AND l.deleted_at IS NULL AND l.merged_into_id IS NULL) AS leads_new,
      (SELECT count(*) FROM public.leads l WHERE l.company_id=cos.id AND l.completed_at >= v_from) AS leads_completed,
      (SELECT count(*) FROM public.quotes q WHERE q.company_id=cos.id AND q.created_at >= v_from AND q.status IN ('sent','viewed','accepted')) AS quotes_sent,
      (SELECT count(*) FROM public.quotes q WHERE q.company_id=cos.id AND q.created_at >= v_from AND q.status = 'accepted') AS quotes_accepted,
      (SELECT COALESCE(round(sum(q.total)::numeric, 2), 0) FROM public.quotes q WHERE q.company_id=cos.id AND q.created_at >= v_from AND q.status = 'accepted') AS accepted_value,
      (SELECT count(*) FROM public.jobs j WHERE j.company_id=cos.id AND j.created_at >= v_from AND j.status <> 'cancelled') AS jobs_booked,
      (SELECT count(DISTINCT p.id) FROM public.profiles p WHERE p.company_id=cos.id AND p.archived_at IS NULL) AS people
    FROM cos)
  SELECT jsonb_build_object('days', GREATEST(1, LEAST(COALESCE(p_days,30), 366)), 'companies',
    COALESCE(jsonb_agg(jsonb_build_object('company_id', id, 'name', name, 'is_master', is_master, 'leads_new', leads_new, 'leads_completed', leads_completed,
      'quotes_sent', quotes_sent, 'quotes_accepted', quotes_accepted, 'accepted_value', accepted_value, 'jobs_booked', jobs_booked, 'people', people,
      'win_rate', CASE WHEN quotes_sent > 0 THEN round(100.0 * quotes_accepted / quotes_sent) END) ORDER BY is_master DESC, name), '[]'::jsonb)) INTO v_out FROM agg;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.network_performance(integer) FROM anon;
REVOKE ALL ON FUNCTION public.network_company_names() FROM anon;
