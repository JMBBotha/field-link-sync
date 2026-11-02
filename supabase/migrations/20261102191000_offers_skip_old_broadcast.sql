-- C follow-up: when New sale offers are on, the old auto-assign-lead broadcast skips leads
-- whose request is a New sale created after switch-on (those go through request_offers instead).
CREATE OR REPLACE FUNCTION public.fl_lead_uses_request_offers(p_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.requests r
    JOIN public.lead_offer_settings s ON s.company_id = r.company_id
    WHERE r.lead_id = p_lead_id AND r.type = 'new_sale'
      AND s.enabled AND r.created_at >= s.enabled_at);
$$;
REVOKE ALL ON FUNCTION public.fl_lead_uses_request_offers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fl_lead_uses_request_offers(uuid) TO service_role, authenticated;
