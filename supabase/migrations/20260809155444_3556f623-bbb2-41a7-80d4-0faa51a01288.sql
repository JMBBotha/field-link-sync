CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','live')),
  provider_sid text,
  from_number text NOT NULL,
  to_number text NOT NULL,
  body text,
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text,
  error_message text,
  customer_id uuid,
  lead_id uuid,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_provider_sid_key
  ON public.whatsapp_messages (provider_sid) WHERE provider_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_from_idx ON public.whatsapp_messages (from_number);
CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx ON public.whatsapp_messages (created_at DESC);

GRANT SELECT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_messages_select_staff" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_select_staff"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'dispatcher')
  );