-- ============================================================
-- 0800BeCool Dispatch v2 — Broadcast Model
-- Lead goes to ALL nearby available agents. First to accept wins.
-- Drops are logged. Admin gets alerted on cherry-picking.
-- ============================================================

-- Step 1: Lead offer tracking — which agents were offered which leads
CREATE TABLE IF NOT EXISTS lead_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES profiles(id),

  -- Offer status lifecycle
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending: offered, waiting for response
  -- accepted: agent took the lead
  -- declined: agent explicitly declined
  -- expired: no response within timeout
  -- released: agent accepted then dropped it

  distance_km DOUBLE PRECISION,            -- how far the agent was when offered
  offer_method TEXT DEFAULT 'auto',        -- 'auto' (broadcast) or 'manual' (admin assigned)

  -- Timestamps
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,               -- when they accepted/declined
  released_at TIMESTAMPTZ,                -- if they dropped it after accepting
  release_reason TEXT,                     -- why they dropped it

  -- Prevent duplicate offers
  UNIQUE(lead_id, agent_id)
);

-- Step 2: Update leads table for broadcast model
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS assignment_method TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS assignment_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS broadcast_radius_km DOUBLE PRECISION DEFAULT 30,
  ADD COLUMN IF NOT EXISTS offer_count INTEGER DEFAULT 0,         -- how many agents were offered
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;               -- when someone accepted

-- Step 3: Admin alerts table (if not exists)
CREATE TABLE IF NOT EXISTS admin_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,     -- 'lead_released', 'lead_expired', 'cherry_pick_warning'
  severity TEXT DEFAULT 'info', -- 'info', 'warning', 'critical'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB,                   -- extra context (lead_id, agent_id, etc.)
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Function to broadcast a lead to nearby agents
CREATE OR REPLACE FUNCTION broadcast_lead_to_agents(
  p_lead_id UUID,
  p_radius_km DOUBLE PRECISION DEFAULT 30
)
RETURNS TABLE(
  agent_id UUID,
  agent_name TEXT,
  distance_km DOUBLE PRECISION,
  offer_method TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_lead RECORD;
  v_is_same_day BOOLEAN;
  v_is_installation BOOLEAN;
BEGIN
  -- Get lead details
  SELECT l.latitude, l.longitude, l.priority, l.service_type, l.scheduled_date
  INTO v_lead
  FROM leads l WHERE l.id = p_lead_id;

  IF v_lead IS NULL OR v_lead.latitude IS NULL OR v_lead.latitude = 0 THEN
    RAISE EXCEPTION 'Lead not found or has no coordinates';
  END IF;

  v_is_same_day := (v_lead.scheduled_date IS NULL OR v_lead.scheduled_date = CURRENT_DATE);
  v_is_installation := (v_lead.service_type IS NOT NULL AND lower(v_lead.service_type) LIKE '%install%');

  -- Find all nearby available agents and create offers
  RETURN QUERY
  WITH nearby_agents AS (
    SELECT
      p.id AS aid,
      p.full_name AS aname,
      -- Pick best location source per dispatch mode
      CASE
        -- Same-day: use live GPS if fresh
        WHEN v_is_same_day AND al.latitude IS NOT NULL
             AND al.last_updated > NOW() - INTERVAL '30 minutes'
             AND al.is_available = true
        THEN calculate_distance_km(al.latitude, al.longitude, v_lead.latitude, v_lead.longitude)

        -- Installation: use workshop
        WHEN v_is_installation AND p.workshop_lat IS NOT NULL
        THEN calculate_distance_km(p.workshop_lat, p.workshop_lng, v_lead.latitude, v_lead.longitude)

        -- Next-day: use home base
        WHEN NOT v_is_same_day AND p.home_lat IS NOT NULL
        THEN calculate_distance_km(p.home_lat, p.home_lng, v_lead.latitude, v_lead.longitude)

        -- Fallbacks
        WHEN al.latitude IS NOT NULL
        THEN calculate_distance_km(al.latitude, al.longitude, v_lead.latitude, v_lead.longitude)
        WHEN p.home_lat IS NOT NULL
        THEN calculate_distance_km(p.home_lat, p.home_lng, v_lead.latitude, v_lead.longitude)
        WHEN p.workshop_lat IS NOT NULL
        THEN calculate_distance_km(p.workshop_lat, p.workshop_lng, v_lead.latitude, v_lead.longitude)

        ELSE 999
      END AS dist,

      CASE
        WHEN v_is_same_day THEN 'broadcast_gps'
        WHEN v_is_installation THEN 'broadcast_workshop'
        ELSE 'broadcast_home'
      END AS method

    FROM profiles p
    INNER JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'field_agent'
    LEFT JOIN agent_locations al ON al.agent_id = p.id
    -- Exclude agents who already have an offer for this lead
    WHERE NOT EXISTS (
      SELECT 1 FROM lead_offers lo WHERE lo.lead_id = p_lead_id AND lo.agent_id = p.id
    )
    -- Same-day urgent: only available agents
    AND (NOT v_is_same_day OR al.is_available IS NOT false)
  )
  -- Insert offers and return
  INSERT INTO lead_offers (lead_id, agent_id, distance_km, offer_method, status)
  SELECT p_lead_id, na.aid, na.dist, na.method, 'pending'
  FROM nearby_agents na
  WHERE na.dist <= p_radius_km
  ORDER BY na.dist ASC
  RETURNING lead_offers.agent_id,
            (SELECT full_name FROM profiles WHERE id = lead_offers.agent_id),
            lead_offers.distance_km,
            lead_offers.offer_method;

END;
$$;

-- Step 5: Function for agent to accept a lead (first-come-first-served)
CREATE OR REPLACE FUNCTION accept_lead(
  p_lead_id UUID,
  p_agent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_current_status TEXT;
  v_already_accepted BOOLEAN;
BEGIN
  -- Check if lead is already accepted by someone else
  SELECT EXISTS(
    SELECT 1 FROM lead_offers
    WHERE lead_id = p_lead_id AND status = 'accepted'
  ) INTO v_already_accepted;

  IF v_already_accepted THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Lead already accepted by another agent'
    );
  END IF;

  -- Check if this agent has an offer
  SELECT status INTO v_current_status
  FROM lead_offers
  WHERE lead_id = p_lead_id AND agent_id = p_agent_id;

  IF v_current_status IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No offer found for this agent'
    );
  END IF;

  IF v_current_status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Offer is no longer pending (status: ' || v_current_status || ')'
    );
  END IF;

  -- Accept: update the offer
  UPDATE lead_offers
  SET status = 'accepted', responded_at = NOW()
  WHERE lead_id = p_lead_id AND agent_id = p_agent_id;

  -- Expire all other pending offers for this lead
  UPDATE lead_offers
  SET status = 'expired', responded_at = NOW()
  WHERE lead_id = p_lead_id AND agent_id != p_agent_id AND status = 'pending';

  -- Update the lead itself
  UPDATE leads
  SET assigned_agent_id = p_agent_id,
      status = 'accepted',
      accepted_at = NOW(),
      assignment_method = (SELECT offer_method FROM lead_offers WHERE lead_id = p_lead_id AND agent_id = p_agent_id)
  WHERE id = p_lead_id;

  -- Audit log
  INSERT INTO audit_log (table_name, record_id, action, new_data)
  VALUES ('leads', p_lead_id::text, 'lead_accepted', jsonb_build_object(
    'agent_id', p_agent_id,
    'method', 'agent_accepted'
  ));

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'agent_id', p_agent_id
  );
END;
$$;

-- Step 6: Function for agent to release/drop a lead (logged + admin alerted)
CREATE OR REPLACE FUNCTION release_lead(
  p_lead_id UUID,
  p_agent_id UUID,
  p_reason TEXT DEFAULT 'No reason provided'
)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_agent_name TEXT;
  v_customer_name TEXT;
  v_release_count INTEGER;
BEGIN
  -- Get context
  SELECT full_name INTO v_agent_name FROM profiles WHERE id = p_agent_id;
  SELECT customer_name INTO v_customer_name FROM leads WHERE id = p_lead_id;

  -- Update the offer
  UPDATE lead_offers
  SET status = 'released', released_at = NOW(), release_reason = p_reason
  WHERE lead_id = p_lead_id AND agent_id = p_agent_id AND status = 'accepted';

  -- Unassign the lead (back to pending)
  UPDATE leads
  SET assigned_agent_id = NULL,
      status = 'pending',
      accepted_at = NULL
  WHERE id = p_lead_id AND assigned_agent_id = p_agent_id;

  -- Count how many times this agent has released leads (cherry-pick detection)
  SELECT COUNT(*) INTO v_release_count
  FROM lead_offers
  WHERE agent_id = p_agent_id AND status = 'released'
    AND released_at > NOW() - INTERVAL '30 days';

  -- Admin alert
  INSERT INTO admin_alerts (alert_type, severity, title, message, data)
  VALUES (
    'lead_released',
    CASE WHEN v_release_count >= 3 THEN 'warning' ELSE 'info' END,
    COALESCE(v_agent_name, 'Agent') || ' released a lead',
    COALESCE(v_agent_name, 'Agent') || ' dropped lead for ' || COALESCE(v_customer_name, 'Unknown') || '. Reason: ' || p_reason
      || CASE WHEN v_release_count >= 3 THEN ' ⚠️ This agent has released ' || v_release_count || ' leads in the past 30 days.' ELSE '' END,
    jsonb_build_object(
      'lead_id', p_lead_id,
      'agent_id', p_agent_id,
      'agent_name', v_agent_name,
      'reason', p_reason,
      'release_count_30d', v_release_count
    )
  );

  -- Audit log
  INSERT INTO audit_log (table_name, record_id, action, new_data)
  VALUES ('leads', p_lead_id::text, 'lead_released', jsonb_build_object(
    'agent_id', p_agent_id,
    'agent_name', v_agent_name,
    'reason', p_reason,
    'release_count_30d', v_release_count
  ));

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', p_lead_id,
    'released_by', p_agent_id,
    'back_to_pool', true,
    'cherry_pick_warning', v_release_count >= 3
  );
END;
$$;

-- Step 7: Indexes
CREATE INDEX IF NOT EXISTS idx_lead_offers_lead ON lead_offers(lead_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_offers_agent ON lead_offers(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_unread ON admin_alerts(is_read, created_at DESC) WHERE is_read = false;

-- Step 8: RLS policies for lead_offers
ALTER TABLE lead_offers ENABLE ROW LEVEL SECURITY;

-- Agents can see their own offers
CREATE POLICY "Agents see own offers" ON lead_offers
  FOR SELECT USING (agent_id = auth.uid());

-- Agents can update their own offers (accept/decline)
CREATE POLICY "Agents update own offers" ON lead_offers
  FOR UPDATE USING (agent_id = auth.uid());

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access" ON lead_offers
  FOR ALL USING (auth.role() = 'service_role');

-- Admin alerts: only admins can see
ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see alerts" ON admin_alerts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Service role alerts" ON admin_alerts
  FOR ALL USING (auth.role() = 'service_role');

-- Permissions
GRANT EXECUTE ON FUNCTION broadcast_lead_to_agents TO authenticated;
GRANT EXECUTE ON FUNCTION accept_lead TO authenticated;
GRANT EXECUTE ON FUNCTION release_lead TO authenticated;
