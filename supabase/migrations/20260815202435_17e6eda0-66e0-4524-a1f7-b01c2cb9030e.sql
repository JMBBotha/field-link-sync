CREATE TABLE IF NOT EXISTS public.voice_session_context (
  session_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.voice_session_context TO service_role;
ALTER TABLE public.voice_session_context ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS voice_session_context_user_idx ON public.voice_session_context(user_id, updated_at DESC);