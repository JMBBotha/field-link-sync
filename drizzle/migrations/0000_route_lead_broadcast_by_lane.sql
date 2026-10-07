CREATE OR REPLACE FUNCTION public.broadcast_lead_to_agents(p_lead_id uuid, p_radius_km numeric DEFAULT 30)
RETURNS TABLE(agent_id uuid, distance_km numeric, offer_method text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_primary_intent public.lead_intent;
  v_dispatch_role text;
BEGIN
  SELECT company_id, primary_intent
    INTO v_company_id, v_primary_intent
  FROM public.leads
  WHERE id = p_lead_id;

  IF NOT public.rh_ops_ok(v_company_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_primary_intent IS NULL THEN
    RETURN;
  END IF;

  v_dispatch_role := CASE
    WHEN v_primary_intent = 'sales' THEN 'sales'
    ELSE 'technician'
  END;

  RETURN QUERY
  WITH candidates AS (
    SELECT c.staff_id, c.distance_km
    FROM public.find_dispatch_candidates(p_lead_id, v_dispatch_role, p_radius_km, NULL) c
  ), inserted AS (
    INSERT INTO public.offers (lead_id, staff_id, company_id, offer_type, sequence, status, distance_km, expires_at)
    SELECT p_lead_id, c.staff_id, v_company_id, 'broadcast', 1, 'pending', c.distance_km, now() + interval '15 minutes'
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.offers o
      WHERE o.lead_id = p_lead_id
        AND o.staff_id = c.staff_id
        AND o.status = 'pending'
    )
    RETURNING staff_id, distance_km
  )
  SELECT i.staff_id, i.distance_km, 'broadcast'::text
  FROM inserted i;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_lead_to_agents(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_lead_to_agents(uuid, numeric) TO service_role;