CREATE OR REPLACE FUNCTION public.broadcast_lead_to_agents(p_lead_id uuid, p_radius_km numeric DEFAULT 30)
RETURNS TABLE(agent_id uuid, distance_km numeric, offer_method text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.leads WHERE id = p_lead_id;

  RETURN QUERY
  WITH candidates AS (
    SELECT c.staff_id, c.distance_km
    FROM public.find_dispatch_candidates(p_lead_id, 'tech', p_radius_km, NULL) c
    UNION
    SELECT c.staff_id, c.distance_km
    FROM public.find_dispatch_candidates(p_lead_id, 'sales', p_radius_km, NULL) c
  ), deduped AS (
    SELECT DISTINCT ON (staff_id) staff_id, distance_km
    FROM candidates
    ORDER BY staff_id, distance_km ASC
  ), inserted AS (
    INSERT INTO public.offers (lead_id, staff_id, company_id, offer_type, sequence, status, distance_km, expires_at)
    SELECT p_lead_id, d.staff_id, v_company_id, 'broadcast', 1, 'pending', d.distance_km, now() + interval '15 minutes'
    FROM deduped d
    WHERE NOT EXISTS (
      SELECT 1 FROM public.offers o
      WHERE o.lead_id = p_lead_id AND o.staff_id = d.staff_id AND o.status = 'pending'
    )
    RETURNING staff_id, distance_km
  )
  SELECT i.staff_id, i.distance_km, 'broadcast'::text FROM inserted i;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_lead_to_agents(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_lead_to_agents(uuid, numeric) TO service_role;