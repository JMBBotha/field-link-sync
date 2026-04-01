
-- ============================================================
-- PHASE 1: Add company_id column to 6 core tenant tables
-- ============================================================

-- 1. leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 2. quotes
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 3. invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 4. customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 5. equipment
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- 6. service_agreements
ALTER TABLE public.service_agreements ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- ============================================================
-- PHASE 2: Backfill existing rows to the single known company
-- ============================================================

UPDATE public.leads SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;
UPDATE public.quotes SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;
UPDATE public.invoices SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;
UPDATE public.customers SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;
UPDATE public.equipment SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;
UPDATE public.service_agreements SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;

-- ============================================================
-- PHASE 3: Create indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_leads_company_id ON public.leads(company_id);
CREATE INDEX IF NOT EXISTS idx_quotes_company_id ON public.quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_id ON public.invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON public.customers(company_id);
CREATE INDEX IF NOT EXISTS idx_equipment_company_id ON public.equipment(company_id);
CREATE INDEX IF NOT EXISTS idx_service_agreements_company_id ON public.service_agreements(company_id);

-- ============================================================
-- PHASE 4: Drop old RLS policies and replace with tenant-scoped ones
-- ============================================================

-- ---------- LEADS ----------
DROP POLICY IF EXISTS "Admins can view all leads" ON public.leads;
DROP POLICY IF EXISTS "Field agents can view their assigned leads" ON public.leads;
DROP POLICY IF EXISTS "Admins can create leads" ON public.leads;
DROP POLICY IF EXISTS "Admins and assigned agents can update leads" ON public.leads;
DROP POLICY IF EXISTS "Admins can delete leads" ON public.leads;

CREATE POLICY "Tenant users can view leads"
  ON public.leads FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant admins can create leads"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can update leads"
  ON public.leads FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND (has_role(auth.uid(), 'admin') OR assigned_agent_id = auth.uid()));

CREATE POLICY "Tenant admins can delete leads"
  ON public.leads FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));

-- ---------- QUOTES ----------
DROP POLICY IF EXISTS "Users can view own quotes or admin all" ON public.quotes;
DROP POLICY IF EXISTS "Users can create quotes" ON public.quotes;
DROP POLICY IF EXISTS "Users can update own quotes" ON public.quotes;
DROP POLICY IF EXISTS "Admins can delete quotes" ON public.quotes;
-- Keep public token policies
DROP POLICY IF EXISTS "Public can view quotes by token" ON public.quotes;
DROP POLICY IF EXISTS "Public can accept quotes by token" ON public.quotes;

CREATE POLICY "Tenant users can view quotes"
  ON public.quotes FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    OR (sales_engineer_id = auth.uid()));

CREATE POLICY "Public can view quotes by token"
  ON public.quotes FOR SELECT
  USING (public_token IS NOT NULL);

CREATE POLICY "Tenant users can create quotes"
  ON public.quotes FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can update quotes"
  ON public.quotes FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND (sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Public can accept quotes by token"
  ON public.quotes FOR UPDATE
  USING (public_token IS NOT NULL)
  WITH CHECK (public_token IS NOT NULL);

CREATE POLICY "Tenant admins can delete quotes"
  ON public.quotes FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));

-- ---------- INVOICES ----------
DROP POLICY IF EXISTS "Agents can view their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Agents can create their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Agents can update their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admins can delete invoices" ON public.invoices;

CREATE POLICY "Tenant users can view invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can create invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND (agent_id = auth.uid() OR has_role(auth.uid(), 'admin')));

CREATE POLICY "Tenant admins can delete invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));

-- ---------- CUSTOMERS ----------
DROP POLICY IF EXISTS "Authenticated users can view customers" ON public.customers;
DROP POLICY IF EXISTS "Admins can create customers" ON public.customers;
DROP POLICY IF EXISTS "Admins can update customers" ON public.customers;
DROP POLICY IF EXISTS "Admins can delete customers" ON public.customers;

CREATE POLICY "Tenant users can view customers"
  ON public.customers FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can create customers"
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can update customers"
  ON public.customers FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant admins can delete customers"
  ON public.customers FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));

-- ---------- EQUIPMENT ----------
DROP POLICY IF EXISTS "Authenticated users can view equipment" ON public.equipment;
DROP POLICY IF EXISTS "Agents can create equipment" ON public.equipment;
DROP POLICY IF EXISTS "Agents can update equipment" ON public.equipment;
DROP POLICY IF EXISTS "Admins can delete equipment" ON public.equipment;

CREATE POLICY "Tenant users can view equipment"
  ON public.equipment FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can create equipment"
  ON public.equipment FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can update equipment"
  ON public.equipment FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant admins can delete equipment"
  ON public.equipment FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));

-- ---------- SERVICE_AGREEMENTS ----------
DROP POLICY IF EXISTS "Admins can view all agreements" ON public.service_agreements;
DROP POLICY IF EXISTS "Admins can create agreements" ON public.service_agreements;
DROP POLICY IF EXISTS "Admins can update agreements" ON public.service_agreements;
DROP POLICY IF EXISTS "Admins can delete agreements" ON public.service_agreements;
DROP POLICY IF EXISTS "Field agents can view agreements for their leads" ON public.service_agreements;

CREATE POLICY "Tenant users can view agreements"
  ON public.service_agreements FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant users can create agreements"
  ON public.service_agreements FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_user_company_id(auth.uid()));

CREATE POLICY "Tenant admins can update agreements"
  ON public.service_agreements FOR UPDATE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins can delete agreements"
  ON public.service_agreements FOR DELETE TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid())
    AND has_role(auth.uid(), 'admin'));
