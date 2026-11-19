-- Website lead email log. Not applied to the live database by this PR.
-- receive-website-lead (service role) inserts one row per send attempt.
-- Company admins can read their own company's rows. Nobody else can.

CREATE TABLE public.lead_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('staff_alert', 'client_confirmation')),
  provider_message_id text,
  error text,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_email_sends IS
  'One row per website-lead staff alert or client confirmation attempt. provider_message_id on success, error on failure.';

CREATE INDEX lead_email_sends_lead_idx ON public.lead_email_sends (lead_id, created_at DESC);
CREATE INDEX lead_email_sends_company_idx ON public.lead_email_sends (company_id, created_at DESC);

ALTER TABLE public.lead_email_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_email_sends_admin_read ON public.lead_email_sends
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_user_company_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.is_company_admin(auth.uid(), company_id)
    )
  );

CREATE POLICY lead_email_sends_service_insert ON public.lead_email_sends
  FOR INSERT TO service_role
  WITH CHECK (true);

REVOKE ALL ON public.lead_email_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_email_sends TO authenticated;
GRANT SELECT, INSERT ON public.lead_email_sends TO service_role;
