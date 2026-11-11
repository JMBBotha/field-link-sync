-- Dashboard Mandy: hand-offs to the build team, and a playbook she reads into her session.
-- Writes still go through the existing RPCs. This adds no back door into leads, jobs, or company settings.

CREATE TABLE IF NOT EXISTS public.mandy_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  role text,
  page text,
  entity_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  transcript text,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mandy_handoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mandy_handoffs_select ON public.mandy_handoffs;
CREATE POLICY mandy_handoffs_select ON public.mandy_handoffs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (company_id IS NOT NULL AND public.fl_is_company_admin(auth.uid(), company_id))
  );
REVOKE INSERT, UPDATE, DELETE ON public.mandy_handoffs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.mandy_playbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  title text NOT NULL,
  when_to_use text NOT NULL,
  answer text NOT NULL,
  allowed_roles text[] NOT NULL DEFAULT ARRAY['all']::text[],
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mandy_playbook_global_title ON public.mandy_playbook (title) WHERE company_id IS NULL;
ALTER TABLE public.mandy_playbook ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mandy_playbook_read ON public.mandy_playbook;
CREATE POLICY mandy_playbook_read ON public.mandy_playbook
  FOR SELECT TO authenticated
  USING (
    active
    AND (company_id IS NULL OR company_id = public.get_user_company_id(auth.uid()))
  );
REVOKE INSERT, UPDATE, DELETE ON public.mandy_playbook FROM anon, authenticated;

INSERT INTO public.mandy_playbook (company_id, title, when_to_use, answer, allowed_roles)
VALUES
  (NULL, 'Who can do what', 'roles, permissions, company settings',
   'Admin can reassign a client, assign any company technician, and cancel or reschedule a visit. A dispatcher can assign technicians and cancel or reschedule, but cannot change the client''s salesperson. A salesperson can book only the technicians assigned to them, and can cancel or reschedule their own client''s visits. A technician can hear today''s jobs and the materials list. Nobody can edit company details from Mandy.',
   ARRAY['all']),
  (NULL, 'Lead acceptance', 'why a lead is not accepted or not offered',
   'A new lead is offered for 5 minutes to the 3 to 5 best-matched salespeople. The offer widens every 2 minutes. Johan is alerted at 10 minutes if nobody has accepted. The location stays hidden until the lead is accepted.',
   ARRAY['all']),
  (NULL, 'Call-out fee', 'call-out, R680, repair, quote deduction',
   'The call-out is R680 excluding VAT per technician visit. It is never deducted from a repair or a quote.',
   ARRAY['all']),
  (NULL, 'Sales technicians', 'which technician a salesperson may book',
   'Salespeople can only book technicians assigned to them. Every assign is checked again on the server with sales_may_book_tech.',
   ARRAY['all']),
  (NULL, 'Cancel or reschedule a visit', 'cancel visit, reschedule, no-show',
   'Cancel uses cancel_booking_visit with a reason: cancelled by client, no longer needed, or no-show. The lead and its quotes stay open. No invoice and no call-out is raised. Reschedule uses set_booking_visits on that same visit. Ask yes before either write.',
   ARRAY['all'])
ON CONFLICT (title) WHERE company_id IS NULL DO NOTHING;
