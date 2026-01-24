-- Add home base coordinates to profiles for proximity calculations
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS home_base_lat numeric,
ADD COLUMN IF NOT EXISTS home_base_lng numeric,
ADD COLUMN IF NOT EXISTS location_tracking_enabled boolean DEFAULT false;

-- Create admin_settings table for geofence configuration
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on admin_settings
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can view settings
CREATE POLICY "Admins can view settings"
ON public.admin_settings
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can create settings
CREATE POLICY "Admins can create settings"
ON public.admin_settings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can update settings
CREATE POLICY "Admins can update settings"
ON public.admin_settings
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can delete settings
CREATE POLICY "Admins can delete settings"
ON public.admin_settings
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default broadcast radius settings
INSERT INTO public.admin_settings (setting_key, setting_value)
VALUES 
  ('broadcast_radius_sales', '{"radius_km": 30}'::jsonb),
  ('broadcast_radius_technical', '{"radius_km": 50}'::jsonb),
  ('broadcast_radius_default', '{"radius_km": 40}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- Add broadcast_radius column to leads for custom radius per lead
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS broadcast_radius_km numeric DEFAULT NULL;

-- Create function to calculate haversine distance between two points
CREATE OR REPLACE FUNCTION public.calculate_distance_km(
  lat1 numeric,
  lng1 numeric,
  lat2 numeric,
  lng2 numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  r numeric := 6371; -- Earth's radius in km
  dlat numeric;
  dlng numeric;
  a numeric;
  c numeric;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  
  a := sin(dlat/2) * sin(dlat/2) + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2) * sin(dlng/2);
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  
  RETURN r * c;
END;
$function$;

-- Create function to get agents within radius of a location
CREATE OR REPLACE FUNCTION public.get_agents_within_radius(
  lead_lat numeric,
  lead_lng numeric,
  radius_km numeric
)
RETURNS TABLE (
  agent_id uuid,
  full_name text,
  distance_km numeric,
  is_available boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    al.agent_id,
    p.full_name,
    calculate_distance_km(lead_lat, lead_lng, al.latitude, al.longitude) as distance_km,
    al.is_available
  FROM public.agent_locations al
  JOIN public.profiles p ON al.agent_id = p.id
  WHERE al.is_available = true
    AND al.latitude IS NOT NULL
    AND al.longitude IS NOT NULL
    AND calculate_distance_km(lead_lat, lead_lng, al.latitude, al.longitude) <= radius_km
  ORDER BY distance_km ASC;
END;
$function$;

-- Enable realtime for admin_settings
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_settings;