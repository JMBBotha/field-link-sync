-- P10 (Johan 2026-10-09 17:54): fix auto-assign broadcast; hide companies markups/rate from techs.
CREATE SCHEMA IF NOT EXISTS backup_p10_20261009;
CREATE TABLE IF NOT EXISTS backup_p10_20261009.fn_defs AS
  SELECT proname, pg_get_functiondef(oid) def FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname IN ('broadcast_lead_to_agents');
CREATE TABLE IF NOT EXISTS backup_p10_20261009.companies_col_grants AS
  SELECT * FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='companies';

-- (1) broadcast: qualify RETURNING (was "distance_km is ambiguous" on every call, so no offer was ever made).
--     Technician leads: only techs whose offer-fit passes (_tech_offer_fit -> _staff_slot_fit:
--     working day/slot, 15 km from previous job/base, travel time). Sales leads: radius as before.
--     find_dispatch_candidates (incl. agent_availability "available now") unchanged.
--     offer_type was 'broadcast' (rejected by offers_offer_type_check); now service_call / sales_estimate,
--     the types accept-offer / decline-offer / OfferCards already handle.
CREATE OR REPLACE FUNCTION public.broadcast_lead_to_agents(p_lead_id uuid, p_radius_km numeric DEFAULT 30)
RETURNS TABLE(agent_id uuid, distance_km numeric, offer_method text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company_id uuid;
  v_primary_intent public.lead_intent;
  v_dispatch_role text;
BEGIN
  SELECT l.company_id, l.primary_intent INTO v_company_id, v_primary_intent
  FROM public.leads l WHERE l.id = p_lead_id;

  IF NOT public.rh_ops_ok(v_company_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_primary_intent IS NULL THEN RETURN; END IF;

  v_dispatch_role := CASE WHEN v_primary_intent = 'sales' THEN 'sales' ELSE 'technician' END;

  RETURN QUERY
  WITH candidates AS (
    SELECT c.staff_id AS cand_id, c.distance_km AS cand_km
    FROM public.find_dispatch_candidates(p_lead_id, v_dispatch_role, p_radius_km, NULL) c
    WHERE v_dispatch_role <> 'technician'
       OR EXISTS (SELECT 1 FROM public._tech_offer_fit(c.staff_id, p_lead_id) f WHERE f.fits)
  ), ins AS (
    INSERT INTO public.offers AS o (lead_id, staff_id, company_id, offer_type, sequence, status, distance_km, expires_at)
    SELECT p_lead_id, c.cand_id, v_company_id,
           CASE WHEN v_dispatch_role = 'sales' THEN 'sales_estimate' ELSE 'service_call' END, 1, 'pending', c.cand_km, now() + interval '15 minutes'
    FROM candidates c
    WHERE NOT EXISTS (SELECT 1 FROM public.offers x
                      WHERE x.lead_id = p_lead_id AND x.staff_id = c.cand_id AND x.status = 'pending')
    RETURNING o.staff_id AS out_id, o.distance_km AS out_km
  )
  SELECT ins.out_id, ins.out_km, 'broadcast'::text FROM ins;
END;
$function$;

-- (2) companies columns: techs (and everyone, via direct select) lose the money columns still exposed;
--     non-money columns added later that screens already read get their missing SELECT grant.
REVOKE SELECT (default_rate, units_markup_percent, materials_markup_percent) ON public.companies FROM authenticated;
GRANT SELECT (work_days, work_start, work_end, office_address, office_lat, office_lng, install_handoff_default)
  ON public.companies TO authenticated;

-- Pricing for quoting/settings: company members who are NOT field techs (admins, dispatchers, sales reps).
CREATE OR REPLACE FUNCTION public.get_company_pricing_settings(p_company_id uuid)
RETURNS TABLE(company_id uuid, default_rate numeric, units_markup_percent numeric,
              materials_markup_percent numeric, materials_waste_percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.default_rate::numeric, c.units_markup_percent::numeric,
         c.materials_markup_percent::numeric, c.materials_waste_percent::numeric
  FROM public.companies c
  WHERE c.id = p_company_id AND auth.uid() IS NOT NULL
    AND public.p4_co_ok(c.id) AND NOT public.is_field_tech_only(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_company_pricing_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_pricing_settings(uuid) TO authenticated;

-- (3) website/phone leads arrive with no lane, and auto-assign skips them ("needs a lane").
--     When the office first sets the lane, run the same auto-assign hook as on insert
--     (trigger_auto_assign_lead itself checks coordinates, pending/new and unassigned).
DROP TRIGGER IF EXISTS on_lead_lane_set_auto_assign ON public.leads;
CREATE TRIGGER on_lead_lane_set_auto_assign
  AFTER UPDATE OF primary_intent ON public.leads
  FOR EACH ROW
  WHEN (OLD.primary_intent IS NULL AND NEW.primary_intent IS NOT NULL)
  EXECUTE FUNCTION public.trigger_auto_assign_lead();
