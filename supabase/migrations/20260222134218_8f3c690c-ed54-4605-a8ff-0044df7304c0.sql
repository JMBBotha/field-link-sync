-- Add missing column to email_preferences
ALTER TABLE public.email_preferences ADD COLUMN IF NOT EXISTS bounce_or_complaint boolean DEFAULT false;

-- Create email_events table
CREATE TABLE IF NOT EXISTS public.email_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id        text NOT NULL,
  event_type      text NOT NULL,
  recipient_email text NOT NULL,
  quote_number    text,
  created_at      timestamptz DEFAULT now(),
  event_data      jsonb,
  processed       boolean DEFAULT false
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_events_quote_event ON public.email_events(quote_number, event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient_event ON public.email_events(recipient_email, event_type);

-- Enable RLS
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

-- RLS: service role / admin full access (edge functions use service role)
CREATE POLICY "Allow service role full access to email_events"
  ON public.email_events FOR ALL
  USING (true) WITH CHECK (true);

-- Admins can view email events
CREATE POLICY "Admins can view email_events"
  ON public.email_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));