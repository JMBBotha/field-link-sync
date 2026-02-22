ALTER TABLE proposals
ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS areas jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'web',
ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_proposals_company_id ON proposals(company_id);
CREATE INDEX IF NOT EXISTS idx_proposals_source ON proposals(source);
CREATE INDEX IF NOT EXISTS idx_proposals_areas_gin ON proposals USING GIN (areas);