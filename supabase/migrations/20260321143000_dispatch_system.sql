-- ============================================================
-- 0800BeCool Dispatch System — Database Migration
-- Adds agent base locations + dispatch scoring function
-- ============================================================

-- Step 1: Add base location columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS workshop_address TEXT,
  ADD COLUMN IF NOT EXISTS workshop_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS workshop_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION,  -- jittered to 500m radius
  ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION,  -- jittered to 500m radius
  ADD COLUMN IF NOT EXISTS home_radius_m INTEGER DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_travel_km DOUBLE PRECISION DEFAULT 50,  -- max willing to travel
  ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}';  -- e.g. {'install', 'repair', 'service', 'samsung', 'daikin'}

-- Step 2: Add scheduling columns to leads (if not present)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_time TIME,
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS assignment_method TEXT DEFAULT 'manual',  -- 'auto_gps', 'auto_home', 'auto_workshop', 'manual'
  ADD COLUMN IF NOT EXISTS assignment_score DOUBLE PRECISION;

-- Step 3: Helper function to jitter home location (500m random offset)
CREATE OR REPLACE FUNCTION jitter_location(
  real_lat DOUBLE PRECISION,
  real_lng DOUBLE PRECISION,
  radius_m INTEGER DEFAULT 500
)
RETURNS TABLE(jittered_lat DOUBLE PRECISION, jittered_lng DOUBLE PRECISION)
LANGUAGE plpgsql AS $$
DECLARE
  -- Random angle in radians
  angle DOUBLE PRECISION := random() * 2 * pi();
  -- Random distance within radius (using sqrt for uniform distribution within circle)
  distance_m DOUBLE PRECISION := sqrt(random()) * radius_m;
  -- Meters per degree latitude (roughly constant)
  m_per_deg_lat DOUBLE PRECISION := 111320;
  -- Meters per degree longitude (varies with latitude)
  m_per_deg_lng DOUBLE PRECISION := 111320 * cos(radians(real_lat));
BEGIN
  jittered_lat := real_lat + (distance_m * cos(angle)) / m_per_deg_lat;
  jittered_lng := real_lng + (distance_m * sin(angle)) / m_per_deg_lng;
  RETURN NEXT;
END;
$$;

-- Step 4: Dispatch scoring function
-- Finds the best available agent for a lead based on:
--   - Same-day/urgent: closest by live GPS
--   - Next-day: closest to home base
--   - Scheduled (installations): closest to workshop
CREATE OR REPLACE FUNCTION find_best_agent(
  p_lead_lat DOUBLE PRECISION,
  p_lead_lng DOUBLE PRECISION,
  p_urgency TEXT DEFAULT 'normal',         -- 'emergency', 'urgent', 'normal', 'low'
  p_service_type TEXT DEFAULT NULL,        -- for skill matching
  p_scheduled_date DATE DEFAULT NULL,      -- NULL = today/ASAP
  p_exclude_agent_ids UUID[] DEFAULT '{}'  -- agents to skip (already declined, etc.)
)
RETURNS TABLE(
  agent_id UUID,
  agent_name TEXT,
  distance_km DOUBLE PRECISION,
  score DOUBLE PRECISION,
  assignment_method TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  is_same_day BOOLEAN;
  is_installation BOOLEAN;
BEGIN
  -- Determine dispatch mode
  is_same_day := (p_scheduled_date IS NULL OR p_scheduled_date = CURRENT_DATE);
  is_installation := (p_service_type IS NOT NULL AND lower(p_service_type) LIKE '%install%');

  RETURN QUERY
  WITH available_agents AS (
    -- Get agents who are available (have a role of field_agent)
    SELECT
      p.id AS aid,
      p.full_name AS aname,
      p.skills,
      p.max_travel_km,
      -- Live GPS location
      al.latitude AS gps_lat,
      al.longitude AS gps_lng,
      al.is_available,
      al.last_updated AS gps_updated,
      -- Base locations
      p.home_lat,
      p.home_lng,
      p.workshop_lat,
      p.workshop_lng
    FROM profiles p
    INNER JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'field_agent'
    LEFT JOIN agent_locations al ON al.agent_id = p.id
    WHERE p.id != ALL(p_exclude_agent_ids)
  ),
  scored AS (
    SELECT
      a.aid,
      a.aname,
      -- Choose which location to measure from based on dispatch mode
      CASE
        -- Same-day urgent: use live GPS if available and recent (< 30 min old)
        WHEN is_same_day AND a.gps_lat IS NOT NULL
             AND a.gps_updated > NOW() - INTERVAL '30 minutes'
             AND a.is_available = true
        THEN calculate_distance_km(a.gps_lat, a.gps_lng, p_lead_lat, p_lead_lng)

        -- Installation (scheduled): use workshop if available
        WHEN is_installation AND a.workshop_lat IS NOT NULL
        THEN calculate_distance_km(a.workshop_lat, a.workshop_lng, p_lead_lat, p_lead_lng)

        -- Next-day / non-urgent: use home base if available
        WHEN NOT is_same_day AND a.home_lat IS NOT NULL
        THEN calculate_distance_km(a.home_lat, a.home_lng, p_lead_lat, p_lead_lng)

        -- Fallback: use whatever location we have
        WHEN a.gps_lat IS NOT NULL
        THEN calculate_distance_km(a.gps_lat, a.gps_lng, p_lead_lat, p_lead_lng)
        WHEN a.home_lat IS NOT NULL
        THEN calculate_distance_km(a.home_lat, a.home_lng, p_lead_lat, p_lead_lng)
        WHEN a.workshop_lat IS NOT NULL
        THEN calculate_distance_km(a.workshop_lat, a.workshop_lng, p_lead_lat, p_lead_lng)

        -- No location at all — max distance
        ELSE 999
      END AS dist_km,

      -- Assignment method label
      CASE
        WHEN is_same_day AND a.gps_lat IS NOT NULL
             AND a.gps_updated > NOW() - INTERVAL '30 minutes'
             AND a.is_available = true
        THEN 'auto_gps'
        WHEN is_installation AND a.workshop_lat IS NOT NULL
        THEN 'auto_workshop'
        WHEN NOT is_same_day AND a.home_lat IS NOT NULL
        THEN 'auto_home'
        ELSE 'auto_fallback'
      END AS method,

      -- Skill match bonus (0 or 0.2)
      CASE
        WHEN p_service_type IS NOT NULL AND a.skills IS NOT NULL
             AND a.skills && ARRAY[lower(
               CASE
                 WHEN lower(p_service_type) LIKE '%install%' THEN 'install'
                 WHEN lower(p_service_type) LIKE '%repair%' THEN 'repair'
                 WHEN lower(p_service_type) LIKE '%service%' THEN 'service'
                 ELSE 'general'
               END
             )]
        THEN 0.2
        ELSE 0.0
      END AS skill_bonus,

      -- Availability bonus (same-day: must be available)
      CASE
        WHEN is_same_day AND (a.is_available IS NULL OR a.is_available = false)
        THEN -10  -- heavy penalty for unavailable agents on same-day
        WHEN a.is_available = true THEN 0.1
        ELSE 0
      END AS availability_bonus

    FROM available_agents a
  )
  SELECT
    s.aid AS agent_id,
    s.aname AS agent_name,
    s.dist_km AS distance_km,
    -- Final score: lower is better (distance penalty - bonuses)
    -- Normalize distance to 0-1 range (50km = score of 1.0)
    (s.dist_km / GREATEST(50, s.dist_km)) - s.skill_bonus - s.availability_bonus AS score,
    s.method AS assignment_method
  FROM scored s
  WHERE s.dist_km <= COALESCE(s.dist_km, 999)  -- include all for now
  ORDER BY score ASC, s.dist_km ASC
  LIMIT 5;  -- return top 5 candidates

END;
$$;

-- Step 5: Create index for faster agent location lookups
CREATE INDEX IF NOT EXISTS idx_agent_locations_available
  ON agent_locations(agent_id, is_available)
  WHERE is_available = true;

CREATE INDEX IF NOT EXISTS idx_leads_assigned
  ON leads(assigned_agent_id, status)
  WHERE assigned_agent_id IS NOT NULL;

-- Step 6: Grant execute permissions
GRANT EXECUTE ON FUNCTION jitter_location TO authenticated;
GRANT EXECUTE ON FUNCTION find_best_agent TO authenticated;
