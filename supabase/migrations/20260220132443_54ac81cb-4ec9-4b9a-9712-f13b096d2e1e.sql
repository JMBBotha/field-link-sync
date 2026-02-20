
-- Add slug column to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS companies_slug_unique ON public.companies (slug) WHERE slug IS NOT NULL;

-- Disable RLS on fb_* tables for demo/preview access
ALTER TABLE public.fb_invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_estimates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_expenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_time_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies DISABLE ROW LEVEL SECURITY;
