-- P6 service areas, lead routing (suggest-first) and area slotting (2026-10-09). No messages are sent by anything here.
CREATE TABLE IF NOT EXISTS public.service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.caller_company_id() REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  center_lat numeric NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng numeric NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_km numeric NOT NULL DEFAULT 25 CHECK (radius_km > 0 AND radius_km <= 300),
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_service_areas_company ON public.service_areas(company_id);
CREATE TABLE IF NOT EXISTS public.service_area_staff (
  area_id uuid NOT NULL REFERENCES public.service_areas(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id, profile_id));
CREATE TABLE IF NOT EXISTS public.lead_routing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_company uuid, to_company uuid,
  area_id uuid REFERENCES public.service_areas(id) ON DELETE SET NULL,
  km numeric, mode text NOT NULL CHECK (mode IN ('suggest','applied','no_match','refused')),
  reason text, decided_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_lead_routing_log_lead ON public.lead_routing_log(lead_id, created_at DESC);
ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_area_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_routing_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p6_areas_select ON public.service_areas;
CREATE POLICY p6_areas_select ON public.service_areas FOR SELECT TO authenticated USING (public.p4_co_ok(company_id) AND NOT public.is_field_tech_only(auth.uid()));
DROP POLICY IF EXISTS p6_areas_write ON public.service_areas;
CREATE POLICY p6_areas_write ON public.service_areas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) AND public.p4_co_ok(company_id))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) AND company_id IS NOT NULL AND public.p4_co_ok(company_id));
CREATE OR REPLACE FUNCTION public.p6_area_ok(_area uuid, _admin boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_areas a WHERE a.id=_area AND public.p4_co_ok(a.company_id))
    AND (NOT _admin OR public.has_role(auth.uid(),'admin'::app_role)) $$;
DROP POLICY IF EXISTS p6_area_staff_select ON public.service_area_staff;
CREATE POLICY p6_area_staff_select ON public.service_area_staff FOR SELECT TO authenticated USING (public.p6_area_ok(area_id, false) OR profile_id = auth.uid());
DROP POLICY IF EXISTS p6_area_staff_write ON public.service_area_staff;
CREATE POLICY p6_area_staff_write ON public.service_area_staff FOR ALL TO authenticated
  USING (public.p6_area_ok(area_id, true))
  WITH CHECK (public.p6_area_ok(area_id, true) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=profile_id AND public.p4_co_ok(p.company_id) AND p.company_id IS NOT NULL));
DROP POLICY IF EXISTS p6_routing_log_select ON public.lead_routing_log;
CREATE POLICY p6_routing_log_select ON public.lead_routing_log FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(),'admin'::app_role) OR (public.has_role(auth.uid(),'dispatcher'::app_role) AND NOT public.is_sales_rep(auth.uid())) OR public.p4_is_platform())
         AND ((from_company IS NOT NULL AND public.p4_co_ok(from_company)) OR (to_company IS NOT NULL AND public.p4_co_ok(to_company))));
-- no direct writes to the log: only the definer RPC below

CREATE OR REPLACE FUNCTION public._p6_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT round((6371 * 2 * asin(sqrt(power(sin(radians((lat2-lat1)/2)),2) + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians((lng2-lng1)/2)),2))))::numeric, 1) $$;

-- Which company's area covers this lead? Suggest by default; master admins may apply (move) an unclaimed lead.
CREATE OR REPLACE FUNCTION public.route_lead_to_company(p_lead uuid, p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.leads%ROWTYPE; v_uid uuid := auth.uid(); v_master boolean; v_area record; v_mode text; v_reason text; v_cust_other int;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE='P0002'; END IF;
  v_master := v_uid IS NULL OR public.p4_is_platform() OR (public.has_role(v_uid,'admin'::app_role) AND public.is_master_company_user(v_uid));
  IF NOT v_master AND NOT ((public.has_role(v_uid,'admin'::app_role) OR (public.has_role(v_uid,'dispatcher'::app_role) AND NOT public.is_sales_rep(v_uid))) AND public.p4_co_ok(l.company_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF p_apply AND NOT v_master THEN RAISE EXCEPTION 'Only the master company can move leads between companies' USING ERRCODE='42501'; END IF;
  IF l.latitude IS NULL OR l.longitude IS NULL THEN
    INSERT INTO public.lead_routing_log(lead_id, from_company, mode, reason, decided_by) VALUES (l.id, l.company_id, 'no_match', 'Lead has no location', v_uid);
    RETURN jsonb_build_object('mode','no_match','reason','Lead has no location');
  END IF;
  SELECT a.id, a.name, a.company_id, c.name AS company_name, public._p6_km(a.center_lat, a.center_lng, l.latitude, l.longitude) AS km INTO v_area
  FROM public.service_areas a JOIN public.companies c ON c.id = a.company_id
  WHERE a.active AND c.status = 'active'
    AND (c.is_master OR EXISTS (SELECT 1 FROM public.company_network_members m JOIN public.companies mc ON mc.id=m.master_company_id AND mc.is_master
                                 WHERE m.member_company_id = c.id AND m.status = 'approved'))
    AND public._p6_km(a.center_lat, a.center_lng, l.latitude, l.longitude) <= a.radius_km
  ORDER BY a.priority DESC, km ASC, a.created_at LIMIT 1;
  IF v_area.id IS NULL THEN
    INSERT INTO public.lead_routing_log(lead_id, from_company, mode, reason, decided_by) VALUES (l.id, l.company_id, 'no_match', 'No service area covers this address', v_uid);
    RETURN jsonb_build_object('mode','no_match','reason','No service area covers this address');
  END IF;
  v_mode := 'suggest';
  IF p_apply THEN
    IF v_area.company_id = l.company_id THEN v_mode := 'refused'; v_reason := 'Already with this company';
    ELSIF l.status <> 'pending' OR l.assigned_agent_id IS NOT NULL THEN v_mode := 'refused'; v_reason := 'Lead is already claimed';
    ELSIF EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = l.id AND o.status IN ('pending','accepted')) THEN v_mode := 'refused'; v_reason := 'Lead has open offers';
    ELSIF EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id) OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = l.id) THEN v_mode := 'refused'; v_reason := 'Lead already has quotes or jobs';
    ELSE
      SELECT count(*) INTO v_cust_other FROM public.leads x WHERE x.customer_id = l.customer_id AND x.id <> l.id;
      IF l.customer_id IS NOT NULL AND v_cust_other > 0 THEN v_mode := 'refused'; v_reason := 'Customer has other history with the current company';
      ELSE
        UPDATE public.leads SET company_id = v_area.company_id WHERE id = l.id;
        IF l.customer_id IS NOT NULL THEN UPDATE public.customers SET company_id = v_area.company_id WHERE id = l.customer_id; END IF;
        v_mode := 'applied'; v_reason := 'Moved to ' || v_area.company_name;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.lead_routing_log(lead_id, from_company, to_company, area_id, km, mode, reason, decided_by)
  VALUES (l.id, l.company_id, v_area.company_id, v_area.id, v_area.km, v_mode, v_reason, v_uid);
  RETURN jsonb_build_object('mode', v_mode, 'reason', v_reason, 'area', v_area.name, 'company_id', v_area.company_id,
    'company', CASE WHEN v_master OR v_area.company_id = l.company_id THEN v_area.company_name ELSE 'Another network company' END, 'km', v_area.km,
    'same_company', v_area.company_id = l.company_id);
END $$;

-- Slot suggestions for the lead's own company: staff of areas covering the lead, using the shared day-fit (hours, bookings, travel)
CREATE OR REPLACE FUNCTION public.area_slot_suggestions(p_lead uuid, p_date date, p_minutes integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.leads%ROWTYPE; v_out jsonb;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE='P0002'; END IF;
  IF NOT ((public.has_role(auth.uid(),'admin'::app_role) OR (public.has_role(auth.uid(),'dispatcher'::app_role) AND NOT public.is_sales_rep(auth.uid())) OR public.p4_is_platform()) AND public.p4_co_ok(l.company_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF l.latitude IS NULL OR l.longitude IS NULL THEN RETURN jsonb_build_object('areas','[]'::jsonb,'staff','[]'::jsonb,'reason','Lead has no location'); END IF;
  WITH ar AS (
    SELECT a.id, a.name FROM public.service_areas a
    WHERE a.company_id = l.company_id AND a.active AND public._p6_km(a.center_lat, a.center_lng, l.latitude, l.longitude) <= a.radius_km),
  st AS (SELECT DISTINCT s.profile_id FROM public.service_area_staff s JOIN ar ON ar.id = s.area_id
         JOIN public.profiles p ON p.id = s.profile_id AND p.company_id = l.company_id AND p.archived_at IS NULL),
  fit AS (SELECT st.profile_id, p.full_name, f.* FROM st JOIN public.profiles p ON p.id = st.profile_id
          CROSS JOIN LATERAL public._staff_slot_fit(st.profile_id, l.id, p_date, '08:00'::time, GREATEST(30, LEAST(p_minutes, 600)), l.latitude, l.longitude, NULL) f)
  SELECT jsonb_build_object(
    'areas', COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM ar), '[]'::jsonb),
    'staff', COALESCE((SELECT jsonb_agg(jsonb_build_object('profile_id', profile_id, 'name', full_name, 'fits', fits, 'km', km, 'label', label, 'reason', reason, 'best_start', best_start)
                        ORDER BY fits DESC, km NULLS LAST, full_name) FROM fit), '[]'::jsonb)) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.route_lead_to_company(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.area_slot_suggestions(uuid, date, integer) FROM anon;
