
CREATE TABLE IF NOT EXISTS agent_affiliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  affiliation_type text NOT NULL CHECK (affiliation_type IN ('sales', 'technical', 'both')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  approved_at timestamptz,
  approved_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (company_id, profile_id)
);

CREATE TABLE IF NOT EXISTS upgrade_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_participant_type text,
  to_participant_type text,
  to_company_id uuid REFERENCES companies(id),
  upgrade_reason text,
  performed_by uuid REFERENCES profiles(id),
  performed_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_affiliations_profile ON agent_affiliations(profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_affiliations_company ON agent_affiliations(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_participant_type ON profiles(participant_type);

ALTER TABLE agent_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_see_affiliations"
ON agent_affiliations FOR ALL
USING (EXISTS (
  SELECT 1 FROM company_members
  WHERE company_members.company_id = agent_affiliations.company_id
  AND company_members.user_id = auth.uid()
));

CREATE POLICY "independents_see_own_affiliations"
ON agent_affiliations FOR SELECT
USING (profile_id = auth.uid());

CREATE POLICY "platform_ops_manage_affiliations"
ON agent_affiliations FOR ALL
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.role IN ('platform_super_admin', 'platform_ops')
));

CREATE POLICY "platform_manage_upgrade_paths"
ON upgrade_paths FOR ALL
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.role IN ('platform_super_admin', 'platform_ops')
));

CREATE POLICY "own_upgrade_paths"
ON upgrade_paths FOR SELECT
USING (profile_id = auth.uid());
