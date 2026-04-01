
-- Agent availability weekly schedule table
CREATE TABLE IF NOT EXISTS public.agent_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time NOT NULL DEFAULT '08:00',
  end_time time NOT NULL DEFAULT '17:00',
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, day_of_week)
);

-- RLS
ALTER TABLE public.agent_availability ENABLE ROW LEVEL SECURITY;

-- Agents manage their own availability
CREATE POLICY "agent_manages_own_availability" ON public.agent_availability
  FOR ALL TO authenticated
  USING (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());

-- Company admins can view availability of their staff and affiliated agents
CREATE POLICY "company_admin_views_availability" ON public.agent_availability
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.user_id = auth.uid() AND cm.role = 'admin'
      AND (
        EXISTS (SELECT 1 FROM public.company_members cm2 WHERE cm2.user_id = agent_availability.agent_id AND cm2.company_id = cm.company_id)
        OR EXISTS (SELECT 1 FROM public.agent_affiliations aa WHERE aa.profile_id = agent_availability.agent_id AND aa.company_id = cm.company_id AND aa.status = 'active')
      )
    )
  );

-- Helper function to check if agent is currently available
CREATE OR REPLACE FUNCTION public.is_agent_available_now(p_agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT is_available FROM public.agent_availability
     WHERE agent_id = p_agent_id
     AND day_of_week = EXTRACT(DOW FROM now())
     AND start_time <= LOCALTIME
     AND end_time >= LOCALTIME
     LIMIT 1),
    false
  );
$$;
