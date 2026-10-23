-- Minimal stand-in for the Supabase schema pieces 0025 touches (local test only).
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE PUBLICATION supabase_realtime;
CREATE TYPE public.app_role AS ENUM ('admin','field_agent','dispatcher','viewer','platform_super_admin','platform_ops');
CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_master boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid, full_name text);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TABLE public.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text, email text, address text);
CREATE TABLE public.company_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, default_deposit_percentage numeric DEFAULT 70,
  is_primary boolean DEFAULT false, updated_at timestamptz DEFAULT now());
CREATE TABLE public.quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_number text, status text, company_id uuid, customer_id uuid,
  customer_name text, lead_id uuid, sales_engineer_id uuid, created_by uuid, total numeric, vat_amount numeric, vat_rate numeric,
  payment_plan jsonb, public_token uuid DEFAULT gen_random_uuid(), accepted_at timestamptz, accepted_by text, accepted_signature jsonb, is_variation boolean DEFAULT false);
CREATE SEQUENCE public.invoice_number_seq;
CREATE OR REPLACE FUNCTION public.generate_invoice_number() RETURNS text LANGUAGE sql AS $$ SELECT 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 3, '0') $$;
CREATE TABLE public.invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number text, lead_id uuid, agent_id uuid, customer_name text,
  customer_phone text, customer_address text, line_items jsonb DEFAULT '[]', subtotal numeric DEFAULT 0, tax_rate numeric DEFAULT 15,
  tax_amount numeric DEFAULT 0, grand_total numeric DEFAULT 0, status text DEFAULT 'draft', notes text, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), due_date date, customer_email text, customer_id uuid, quote_id uuid, company_id uuid,
  deposit_type text, deposit_value numeric, deposit_amount numeric, sent_at timestamptz, sent_method text, sent_by uuid);
CREATE TABLE public.invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid, description text, quantity numeric DEFAULT 1,
  unit_price numeric DEFAULT 0, amount numeric DEFAULT 0);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text,
  read boolean DEFAULT false, related_id uuid, created_at timestamptz DEFAULT now(), metadata jsonb DEFAULT '{}');
CREATE OR REPLACE FUNCTION public.rh_assert(_block_sales boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE OR REPLACE FUNCTION public.payment_plan_ok(p jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT p IS NOT NULL $$;
CREATE OR REPLACE FUNCTION public.caller_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT company_id FROM public.profiles WHERE id = auth.uid() $$;
-- Stand-in for notify_document_sent: records the "email" instead of net.http_post.
CREATE TABLE public.fake_outbox (id bigserial, invoice_id uuid, to_email text, send_trigger text, at timestamptz DEFAULT clock_timestamp());
CREATE OR REPLACE FUNCTION public.notify_document_sent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('app.invoice_skip_email', true), '') = 'on' THEN RETURN NEW; END IF;
  INSERT INTO public.fake_outbox (invoice_id, to_email, send_trigger)
  VALUES (NEW.id, NEW.customer_email, COALESCE(NULLIF(current_setting('app.invoice_send_trigger', true), ''), 'status_sent'));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoices_sent_email AFTER UPDATE ON public.invoices FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'sent') EXECUTE FUNCTION public.notify_document_sent();
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON public.invoices TO authenticated;
