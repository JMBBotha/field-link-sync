
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS route_order integer,
  ADD COLUMN IF NOT EXISTS route_id uuid,
  ADD COLUMN IF NOT EXISTS travel_seconds integer,
  ADD COLUMN IF NOT EXISTS travel_meters integer,
  ADD COLUMN IF NOT EXISTS optimized_at timestamptz;

ALTER TABLE public.job_schedules
  ADD COLUMN IF NOT EXISTS route_order integer,
  ADD COLUMN IF NOT EXISTS route_id uuid,
  ADD COLUMN IF NOT EXISTS optimized_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_assignments_route
  ON public.assignments (profile_id, route_id, route_order);

CREATE INDEX IF NOT EXISTS idx_job_schedules_route
  ON public.job_schedules (agent_id, scheduled_date, route_order);
