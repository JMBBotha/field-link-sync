CREATE TABLE public.assistant_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid,
  resolved_role text NOT NULL DEFAULT 'unknown',
  tool_name text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_count integer,
  outcome text NOT NULL,
  error_code text,
  channel text NOT NULL DEFAULT 'text',
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.assistant_audit_logs TO authenticated;
GRANT ALL ON public.assistant_audit_logs TO service_role;

ALTER TABLE public.assistant_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own assistant audit rows"
ON public.assistant_audit_logs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can read their company assistant audit rows"
ON public.assistant_audit_logs
FOR SELECT
TO authenticated
USING (
  company_id IS NOT NULL
  AND company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'platform_super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'platform_ops'::public.app_role)
  )
);

CREATE INDEX idx_assistant_audit_logs_user_created ON public.assistant_audit_logs (user_id, created_at DESC);
CREATE INDEX idx_assistant_audit_logs_company_created ON public.assistant_audit_logs (company_id, created_at DESC);

ALTER TABLE public.assistant_audit_logs
  ADD CONSTRAINT assistant_audit_logs_outcome_check
  CHECK (outcome IN ('success','not_found','access_denied','invalid_input','rejected','error'));

ALTER TABLE public.assistant_audit_logs
  ADD CONSTRAINT assistant_audit_logs_channel_check
  CHECK (channel IN ('text','voice'));