CREATE TABLE public.whatsapp_conversation_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  state text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  job_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_conversation_state_phone_key ON public.whatsapp_conversation_state (phone);
CREATE INDEX whatsapp_conversation_state_expires_idx ON public.whatsapp_conversation_state (expires_at);

GRANT SELECT ON public.whatsapp_conversation_state TO authenticated;
GRANT ALL ON public.whatsapp_conversation_state TO service_role;

ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_state_select_staff"
ON public.whatsapp_conversation_state
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'dispatcher'::app_role));

CREATE TRIGGER update_whatsapp_conversation_state_updated_at
BEFORE UPDATE ON public.whatsapp_conversation_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();