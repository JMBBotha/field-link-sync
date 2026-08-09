
CREATE EXTENSION IF NOT EXISTS postgis;

-- staff fields on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dispatch_role text CHECK (dispatch_role IN ('sales_engineer','technician')),
  ADD COLUMN IF NOT EXISTS dispatch_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS home_location geography(Point,4326);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS location geography(Point,4326),
  ADD COLUMN IF NOT EXISTS needs_manual_assignment boolean NOT NULL DEFAULT false;

-- backfill
UPDATE public.profiles
   SET home_location = ST_SetSRID(ST_MakePoint(COALESCE(home_lng, home_base_lng)::float8, COALESCE(home_lat, home_base_lat)::float8),4326)::geography
 WHERE home_location IS NULL
   AND COALESCE(home_lng, home_base_lng) IS NOT NULL
   AND COALESCE(home_lat, home_base_lat) IS NOT NULL;

UPDATE public.leads
   SET location = ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8),4326)::geography
 WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
   AND latitude <> 0 AND longitude <> 0;

CREATE INDEX IF NOT EXISTS idx_profiles_home_location ON public.profiles USING gist (home_location);
CREATE INDEX IF NOT EXISTS idx_leads_location ON public.leads USING gist (location);

-- keep geography in sync
CREATE OR REPLACE FUNCTION public.sync_profile_home_location()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.home_lng, NEW.home_base_lng) IS NOT NULL AND COALESCE(NEW.home_lat, NEW.home_base_lat) IS NOT NULL THEN
    NEW.home_location := ST_SetSRID(ST_MakePoint(COALESCE(NEW.home_lng, NEW.home_base_lng)::float8, COALESCE(NEW.home_lat, NEW.home_base_lat)::float8),4326)::geography;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_profile_home_location ON public.profiles;
CREATE TRIGGER trg_sync_profile_home_location
BEFORE INSERT OR UPDATE OF home_lat, home_lng, home_base_lat, home_base_lng ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_home_location();

CREATE OR REPLACE FUNCTION public.sync_lead_location()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL AND NEW.latitude <> 0 AND NEW.longitude <> 0 THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8),4326)::geography;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_lead_location ON public.leads;
CREATE TRIGGER trg_sync_lead_location
BEFORE INSERT OR UPDATE OF latitude, longitude ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_location();

-- offers
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid,
  offer_type text NOT NULL DEFAULT 'sales_estimate' CHECK (offer_type IN ('sales_estimate','service_call')),
  sequence integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  distance_km numeric,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.offers TO authenticated;
GRANT ALL ON public.offers TO service_role;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view their offers" ON public.offers
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'dispatcher')
         OR (company_id IS NOT NULL AND company_id = public.get_user_company_id(auth.uid())));

CREATE POLICY "Staff can respond to their offers" ON public.offers
  FOR UPDATE TO authenticated
  USING (staff_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'dispatcher'))
  WITH CHECK (staff_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'dispatcher'));

CREATE POLICY "Admins can create offers" ON public.offers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'dispatcher'));

-- only one accepted offer per lead (atomic claim guard)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_accepted_offer_per_lead
  ON public.offers (lead_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS idx_offers_pending_expiry ON public.offers (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_offers_staff_status ON public.offers (staff_id, status);

DROP TRIGGER IF EXISTS trg_offers_updated_at ON public.offers;
CREATE TRIGGER trg_offers_updated_at BEFORE UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.offers;

-- geo candidate finder
CREATE OR REPLACE FUNCTION public.find_dispatch_candidates(
  p_lead_id uuid,
  p_role text,
  p_radius_km numeric DEFAULT 40,
  p_skill text DEFAULT NULL
)
RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (SELECT location, company_id FROM public.leads WHERE id = p_lead_id)
  SELECT p.id,
         p.full_name,
         ROUND((ST_Distance(p.home_location, l.location) / 1000)::numeric, 2) AS distance_km
  FROM public.profiles p, l
  WHERE p.dispatch_active = true
    AND p.dispatch_role = p_role
    AND p.home_location IS NOT NULL
    AND l.location IS NOT NULL
    AND (l.company_id IS NULL OR p.company_id = l.company_id OR p.participant_type IN ('independent_sales','independent_tech'))
    AND ST_DWithin(p.home_location, l.location, p_radius_km * 1000)
    AND (p_skill IS NULL OR p_skill = ANY(COALESCE(p.skills, ARRAY[]::text[])))
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
  ORDER BY distance_km ASC;
$$;

REVOKE ALL ON FUNCTION public.find_dispatch_candidates(uuid,text,numeric,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_dispatch_candidates(uuid,text,numeric,text) TO authenticated, service_role;

-- atomic offer claim
CREATE OR REPLACE FUNCTION public.claim_offer(p_offer_id uuid, p_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer public.offers%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Offer not found');
  END IF;
  IF v_offer.staff_id <> p_staff_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'Offer belongs to another staff member');
  END IF;
  IF v_offer.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Offer is no longer pending');
  END IF;
  IF v_offer.expires_at < now() THEN
    UPDATE public.offers SET status='expired' WHERE id = p_offer_id;
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Offer expired');
  END IF;
  IF EXISTS (SELECT 1 FROM public.offers WHERE lead_id = v_offer.lead_id AND status='accepted') THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'This lead has already been claimed');
  END IF;

  UPDATE public.offers
     SET status='accepted', responded_at = now()
   WHERE id = p_offer_id;

  UPDATE public.offers
     SET status='cancelled', responded_at = now()
   WHERE lead_id = v_offer.lead_id AND id <> p_offer_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'lead_id', v_offer.lead_id, 'offer_type', v_offer.offer_type, 'company_id', v_offer.company_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'This lead has already been claimed');
END; $$;

REVOKE ALL ON FUNCTION public.claim_offer(uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_offer(uuid,uuid) TO authenticated, service_role;
