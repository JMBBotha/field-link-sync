-- acct4: unified expenses (supplier, category, incl/VAT/excl with rate by date, private receipt, optional job).
-- SA VAT rate by document date: 14% before 2018-04-01, 15% from then (also used by step 6).
CREATE OR REPLACE FUNCTION public.vat_rate_for(p_date date) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $f$ SELECT CASE WHEN p_date < DATE '2018-04-01' THEN 14.0 ELSE 15.0 END $f$;
GRANT EXECUTE ON FUNCTION public.vat_rate_for(date) TO authenticated;

CREATE OR REPLACE FUNCTION public._acct_is_office(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT auth.uid() IS NOT NULL AND NOT public.is_field_tech_only(auth.uid()) AND NOT public.is_sales_rep(auth.uid())
     AND public.is_ops_user(auth.uid()) AND public.is_company_member(auth.uid(), p_company)
$f$;
REVOKE ALL ON FUNCTION public._acct_is_office(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._acct_is_office(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_id uuid REFERENCES public.suppliers(id),
  supplier_name text,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('materials','equipment','subcontractor','fuel_travel','vehicle','tools','rent','utilities','telecoms','insurance','professional_fees','bank_charges','marketing','office','other')),
  description text,
  amount_incl numeric(12,2) NOT NULL CHECK (amount_incl > 0),
  vat_claimable boolean NOT NULL DEFAULT true,
  vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_excl numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text,
  reference text,
  receipt_path text,
  job_id uuid REFERENCES public.jobs(id),
  source text NOT NULL DEFAULT 'manual',
  source_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_company_date_idx ON public.expenses(company_id, expense_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS expenses_source_uidx ON public.expenses(source, source_id) WHERE source_id IS NOT NULL;

-- VAT is always computed (rate by date; 0 when the supplier isn't VAT-registered); job must be same company.
CREATE OR REPLACE FUNCTION public._expenses_compute() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.company_id := OLD.company_id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
    IF NEW.status = 'archived' AND OLD.status <> 'archived' THEN NEW.archived_at := now(); NEW.archived_by := auth.uid(); END IF;
  END IF;
  NEW.vat_rate := CASE WHEN NEW.vat_claimable THEN public.vat_rate_for(NEW.expense_date) ELSE 0 END;
  NEW.vat_amount := ROUND(NEW.amount_incl * NEW.vat_rate / (100 + NEW.vat_rate), 2);
  NEW.amount_excl := NEW.amount_incl - NEW.vat_amount;
  NEW.updated_at := now();
  IF NEW.supplier_id IS NOT NULL AND NULLIF(btrim(COALESCE(NEW.supplier_name, '')), '') IS NULL THEN
    SELECT COALESCE(NULLIF(trading_name, ''), name) INTO NEW.supplier_name FROM public.suppliers WHERE id = NEW.supplier_id;
  END IF;
  IF NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.company_id IS NOT DISTINCT FROM NEW.company_id) THEN
    RAISE EXCEPTION 'Job belongs to another company';
  END IF;
  IF NEW.receipt_path IS NOT NULL AND split_part(NEW.receipt_path, '/', 1) <> NEW.company_id::text THEN
    RAISE EXCEPTION 'Receipt must be stored in the company folder';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER trg_expenses_compute BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public._expenses_compute();

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expenses FROM anon;
REVOKE DELETE, TRUNCATE ON public.expenses FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.expenses TO authenticated;
CREATE POLICY exp_office_read ON public.expenses FOR SELECT TO authenticated USING (public._acct_is_office(company_id));
CREATE POLICY exp_office_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK (public._acct_is_office(company_id) AND created_by = auth.uid());
CREATE POLICY exp_office_update ON public.expenses FOR UPDATE TO authenticated USING (public._acct_is_office(company_id)) WITH CHECK (public._acct_is_office(company_id));
CREATE POLICY tech_lockdown_all ON public.expenses AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_field_tech_only(auth.uid())) WITH CHECK (NOT public.is_field_tech_only(auth.uid()));
CREATE POLICY p4_company_scope ON public.expenses AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_co_ok(company_id)) WITH CHECK (public.p4_co_ok(company_id));

-- Receipts: <company_id>/expenses/<file> in the private expense-receipts bucket; office staff only for that subfolder.
CREATE OR REPLACE FUNCTION public._acct_receipt_ok(p_bucket text, p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE f text[];
BEGIN
  IF p_bucket IS DISTINCT FROM 'expense-receipts' THEN RETURN true; END IF;
  f := storage.foldername(p_name);
  IF f[2] IS DISTINCT FROM 'expenses' THEN RETURN true; END IF;
  IF f[1] !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  RETURN public._acct_is_office(f[1]::uuid);
END $f$;
GRANT EXECUTE ON FUNCTION public._acct_receipt_ok(text, text) TO authenticated;
CREATE POLICY acct4_expense_receipts_office ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (public._acct_receipt_ok(bucket_id, name)) WITH CHECK (public._acct_receipt_ok(bucket_id, name));

-- Migrate the two old (empty) expense tables; they stay in place (archive, never delete). Idempotent via (source, source_id).
INSERT INTO public.expenses (company_id, expense_date, category, description, amount_incl, vat_claimable, supplier_name, receipt_path, source, source_id, created_by, created_at)
SELECT f.company_id, COALESCE(f.date, f.created_at::date), CASE WHEN f.category IN ('materials','equipment','subcontractor','fuel_travel','vehicle','tools','rent','utilities','telecoms','insurance','professional_fees','bank_charges','marketing','office') THEN f.category ELSE 'other' END,
       NULLIF(concat_ws(' — ', f.category, f.notes), ''), f.amount, false, f.vendor, NULL, 'fb_expenses', f.id, NULL, f.created_at
  FROM public.fb_expenses f WHERE f.company_id IS NOT NULL AND f.amount > 0
ON CONFLICT DO NOTHING;
INSERT INTO public.expenses (company_id, expense_date, category, description, amount_incl, vat_claimable, receipt_path, source, source_id, created_by, created_at)
SELECT l.company_id, COALESCE(e.expense_date, e.created_at::date), 'other', e.description, e.amount, false, NULL, 'job_expenses', e.id, e.created_by, e.created_at
  FROM public.job_expenses e JOIN public.leads l ON l.id = e.lead_id WHERE l.company_id IS NOT NULL AND e.amount > 0
ON CONFLICT DO NOTHING;
