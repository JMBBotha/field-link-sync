
-- Add company_id to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_id uuid;

-- Companies table
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  address jsonb,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Company members table (role management for multi-tenant)
CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Security definer function to get user's company_id
CREATE OR REPLACE FUNCTION public.get_user_company_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = _user_id
$$;

-- Security definer to check company membership role
CREATE OR REPLACE FUNCTION public.is_company_admin(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = _user_id AND company_id = _company_id AND role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = _user_id AND company_id = _company_id
  )
$$;

-- Companies RLS: only admins of the company can manage
CREATE POLICY "Company admins can view their company"
  ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), id));

CREATE POLICY "Company admins can update their company"
  ON public.companies FOR UPDATE TO authenticated
  USING (public.is_company_admin(auth.uid(), id));

CREATE POLICY "Platform admins can manage all companies"
  ON public.companies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Company members RLS
CREATE POLICY "Members can view same company members"
  ON public.company_members FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), company_id));

CREATE POLICY "Company admins can insert members"
  ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin(auth.uid(), company_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Company admins can delete members"
  ON public.company_members FOR DELETE TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id) OR public.has_role(auth.uid(), 'admin'));

-- fb_contacts
CREATE TABLE public.fb_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  company_name text,
  address jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_contacts company access" ON public.fb_contacts FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- fb_projects
CREATE TABLE public.fb_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  client_id uuid REFERENCES public.fb_contacts(id),
  budget numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_projects company access" ON public.fb_projects FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- fb_invoices
CREATE TABLE public.fb_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.fb_contacts(id),
  invoice_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled')),
  amount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_invoices company access" ON public.fb_invoices FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- fb_estimates
CREATE TABLE public.fb_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.fb_contacts(id),
  estimate_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined')),
  amount numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_estimates company access" ON public.fb_estimates FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- fb_expenses
CREATE TABLE public.fb_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'General',
  amount numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  vendor text,
  notes text,
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_expenses company access" ON public.fb_expenses FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- fb_time_entries
CREATE TABLE public.fb_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.fb_projects(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  duration interval NOT NULL DEFAULT '0'::interval,
  date date NOT NULL DEFAULT CURRENT_DATE,
  billable boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_time_entries company access" ON public.fb_time_entries FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- fb_payments
CREATE TABLE public.fb_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.fb_invoices(id),
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'bank_transfer',
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_payments company access" ON public.fb_payments FOR ALL TO authenticated
  USING (public.is_company_member(auth.uid(), company_id))
  WITH CHECK (public.is_company_member(auth.uid(), company_id));

-- Add FK from profiles.company_id to companies
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX idx_company_members_user ON public.company_members(user_id);
CREATE INDEX idx_company_members_company ON public.company_members(company_id);
CREATE INDEX idx_fb_invoices_company ON public.fb_invoices(company_id);
CREATE INDEX idx_fb_estimates_company ON public.fb_estimates(company_id);
CREATE INDEX idx_fb_expenses_company ON public.fb_expenses(company_id);
CREATE INDEX idx_fb_time_entries_company ON public.fb_time_entries(company_id);
CREATE INDEX idx_fb_payments_company ON public.fb_payments(company_id);
CREATE INDEX idx_fb_contacts_company ON public.fb_contacts(company_id);
CREATE INDEX idx_fb_projects_company ON public.fb_projects(company_id);
