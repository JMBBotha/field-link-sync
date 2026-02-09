
-- Sync conflicts log table for admin visibility
CREATE TABLE public.sync_conflicts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  conflict_type TEXT NOT NULL DEFAULT 'version_mismatch',
  local_data JSONB,
  server_data JSONB,
  resolution TEXT NOT NULL DEFAULT 'pending', -- pending, keep_local, use_server, auto_lww
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

-- Agents can insert conflicts
CREATE POLICY "Agents can log conflicts"
  ON public.sync_conflicts FOR INSERT
  WITH CHECK (agent_id = auth.uid());

-- Agents can view own conflicts
CREATE POLICY "Agents can view own conflicts"
  ON public.sync_conflicts FOR SELECT
  USING (agent_id = auth.uid());

-- Agents can update own conflicts (resolution)
CREATE POLICY "Agents can resolve own conflicts"
  ON public.sync_conflicts FOR UPDATE
  USING (agent_id = auth.uid());

-- Admins can view all conflicts
CREATE POLICY "Admins can view all conflicts"
  ON public.sync_conflicts FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete conflicts
CREATE POLICY "Admins can delete conflicts"
  ON public.sync_conflicts FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for quick admin queries
CREATE INDEX idx_sync_conflicts_created ON public.sync_conflicts(created_at DESC);
CREATE INDEX idx_sync_conflicts_resolution ON public.sync_conflicts(resolution);
