CREATE TABLE IF NOT EXISTS public.unassigned_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id uuid,
  reason text NOT NULL,
  priority text NOT NULL DEFAULT 'standard',
  escalate_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  escalated boolean NOT NULL DEFAULT false,
  escalated_at timestamptz,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unassigned_queue TO authenticated;
GRANT ALL ON public.unassigned_queue TO service_role;

ALTER TABLE public.unassigned_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops can view unassigned queue"
ON public.unassigned_queue FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'dispatcher'::app_role)
  OR public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
);

CREATE POLICY "Ops can update unassigned queue"
ON public.unassigned_queue FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'dispatcher'::app_role)
  OR public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'dispatcher'::app_role)
  OR public.has_role(auth.uid(), 'platform_super_admin'::app_role)
  OR public.has_role(auth.uid(), 'platform_ops'::app_role)
);

CREATE INDEX IF NOT EXISTS idx_unassigned_queue_open
  ON public.unassigned_queue (escalate_at) WHERE resolved = false;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_unassigned_queue_open_lead
  ON public.unassigned_queue (lead_id) WHERE resolved = false;

DROP TRIGGER IF EXISTS trg_unassigned_queue_updated_at ON public.unassigned_queue;
CREATE TRIGGER trg_unassigned_queue_updated_at
BEFORE UPDATE ON public.unassigned_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.find_dispatch_candidates_multi(
  p_lead_id uuid,
  p_role text,
  p_radius_km numeric,
  p_skills text[] DEFAULT NULL
)
RETURNS TABLE(staff_id uuid, full_name text, distance_km numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND (
      p_skills IS NULL
      OR array_length(p_skills, 1) IS NULL
      OR COALESCE(p.skills, ARRAY[]::text[]) && p_skills
    )
    AND EXISTS (
      SELECT 1 FROM public.agent_availability a
      WHERE a.agent_id = p.id AND a.is_available = true
        AND a.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Johannesburg'))
        AND a.start_time <= (now() AT TIME ZONE 'Africa/Johannesburg')::time
        AND a.end_time   >= (now() AT TIME ZONE 'Africa/Johannesburg')::time
    )
  ORDER BY distance_km ASC;
$$;

REVOKE ALL ON FUNCTION public.find_dispatch_candidates_multi(uuid, text, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_dispatch_candidates_multi(uuid, text, numeric, text[]) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.unassigned_queue;