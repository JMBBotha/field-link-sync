CREATE TABLE public.nl_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid,
  tool_name text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  status text NOT NULL DEFAULT 'executed',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nl_audit_log TO authenticated;
GRANT ALL ON public.nl_audit_log TO service_role;

ALTER TABLE public.nl_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own nl audit rows"
ON public.nl_audit_log FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE INDEX idx_nl_audit_log_user_created ON public.nl_audit_log (user_id, created_at DESC);

CREATE TABLE public.nl_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nl_request_log TO authenticated;
GRANT ALL ON public.nl_request_log TO service_role;

ALTER TABLE public.nl_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own nl request rows"
ON public.nl_request_log FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE INDEX idx_nl_request_log_user_created ON public.nl_request_log (user_id, created_at DESC);