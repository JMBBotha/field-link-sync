
-- Jobs table (central dispatch unit)
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id),
  lead_id uuid REFERENCES leads(id),
  quote_id uuid REFERENCES quotes(id),
  title text NOT NULL,
  description text,
  address text,
  lat numeric,
  lng numeric,
  scheduled_for timestamptz,
  estimated_duration interval DEFAULT '2 hours',
  priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Assignments table (fulfillment)
CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  assigned_by uuid REFERENCES profiles(id),
  assignment_type text DEFAULT 'internal' CHECK (assignment_type IN ('internal', 'affiliated', 'network')),
  status text DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'in_progress', 'completed')),
  eta timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_company_scheduled ON jobs(company_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_assignments_job ON assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_assignments_profile ON assignments(profile_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

-- RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- Jobs: company members see their company's jobs
CREATE POLICY "company_sees_own_jobs" ON jobs FOR ALL USING (
  company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid())
);

-- Jobs: assigned independents can view the job
CREATE POLICY "assigned_sees_job" ON jobs FOR SELECT USING (
  id IN (SELECT job_id FROM assignments WHERE profile_id = auth.uid())
);

-- Jobs: platform ops sees all
CREATE POLICY "platform_ops_all_jobs" ON jobs FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('platform_super_admin', 'platform_ops'))
);

-- Assignments: see your own assignments
CREATE POLICY "own_assignments" ON assignments FOR ALL USING (profile_id = auth.uid());

-- Assignments: company members see assignments on their jobs
CREATE POLICY "company_sees_job_assignments" ON assignments FOR ALL USING (
  job_id IN (SELECT id FROM jobs WHERE company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid()))
);

-- Assignments: platform ops sees all
CREATE POLICY "platform_ops_all_assignments" ON assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('platform_super_admin', 'platform_ops'))
);

-- Enable realtime for jobs
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;
