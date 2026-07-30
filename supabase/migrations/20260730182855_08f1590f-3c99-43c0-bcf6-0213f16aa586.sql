CREATE TABLE public.visual_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  client_id uuid references public.customers(id) on delete set null,
  created_by uuid,
  title text not null default 'Untitled Proposal',
  status text not null default 'draft',
  sections jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  public_token uuid default gen_random_uuid(),
  accepted_by_name text,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE public.visual_proposal_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  created_by uuid,
  name text not null,
  description text,
  thumbnail_url text,
  sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visual_proposals TO authenticated;
GRANT ALL ON public.visual_proposals TO service_role;
GRANT SELECT, UPDATE ON public.visual_proposals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visual_proposal_templates TO authenticated;
GRANT ALL ON public.visual_proposal_templates TO service_role;

ALTER TABLE public.visual_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visual_proposal_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view visual proposals" ON public.visual_proposals FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Tenant users can create visual proposals" ON public.visual_proposals FOR INSERT TO authenticated
  WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Tenant users can update visual proposals" ON public.visual_proposals FOR UPDATE TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Tenant admins can delete visual proposals" ON public.visual_proposals FOR DELETE TO authenticated
  USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anon can view visual proposal by token" ON public.visual_proposals FOR SELECT TO anon
  USING (public_token IS NOT NULL);
CREATE POLICY "Anon can accept visual proposal by token" ON public.visual_proposals FOR UPDATE TO anon
  USING (public_token IS NOT NULL) WITH CHECK (public_token IS NOT NULL);

CREATE POLICY "Tenant users can view visual proposal templates" ON public.visual_proposal_templates FOR SELECT TO authenticated
  USING (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Tenant users can create visual proposal templates" ON public.visual_proposal_templates FOR INSERT TO authenticated
  WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Tenant users can update visual proposal templates" ON public.visual_proposal_templates FOR UPDATE TO authenticated
  USING (company_id = get_user_company_id(auth.uid()))
  WITH CHECK (company_id = get_user_company_id(auth.uid()));
CREATE POLICY "Tenant admins can delete visual proposal templates" ON public.visual_proposal_templates FOR DELETE TO authenticated
  USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_visual_proposals_updated_at BEFORE UPDATE ON public.visual_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_visual_proposal_templates_updated_at BEFORE UPDATE ON public.visual_proposal_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_visual_proposals_company ON public.visual_proposals(company_id, created_at DESC);
CREATE INDEX idx_visual_proposal_templates_company ON public.visual_proposal_templates(company_id, created_at DESC);