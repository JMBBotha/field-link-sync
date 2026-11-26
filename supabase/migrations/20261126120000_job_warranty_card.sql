-- Job / warranty card (preview). Private company-scoped PDF.
-- Auto-send stays OFF until a company turns the switch on.
-- Rollback: supabase/manual/20261126120000_job_warranty_card_rollback.sql

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS auto_send_job_card boolean NOT NULL DEFAULT false;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS job_card_photo_mode text NOT NULL DEFAULT 'client_visible_else_after';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_job_card_photo_mode_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_job_card_photo_mode_check
      CHECK (job_card_photo_mode IN ('client_visible_else_after', 'client_visible_only'));
  END IF;
END $$;

COMMENT ON COLUMN public.companies.auto_send_job_card IS
  'When true, finishing a job may email the job / warranty card to the client. Default false.';
COMMENT ON COLUMN public.companies.job_card_photo_mode IS
  'client_visible_else_after: photos marked for the client, or after photos when none are marked. client_visible_only: marked photos only.';

CREATE TABLE IF NOT EXISTS public.job_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  signed boolean NOT NULL DEFAULT false,
  client_name text,
  signed_at timestamptz,
  completed_at timestamptz,
  technician_name text,
  work_summary text,
  issued_by uuid,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_cards_job_unique UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS job_cards_company_idx ON public.job_cards (company_id);
CREATE INDEX IF NOT EXISTS job_cards_customer_idx ON public.job_cards (customer_id);

REVOKE ALL ON public.job_cards FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.job_cards TO authenticated;
GRANT ALL ON public.job_cards TO service_role;

ALTER TABLE public.job_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_cards_select ON public.job_cards;
CREATE POLICY job_cards_select ON public.job_cards
  FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id());

DROP POLICY IF EXISTS job_cards_insert ON public.job_cards;
CREATE POLICY job_cards_insert ON public.job_cards
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.caller_company_id()
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.company_id = company_id)
    AND (customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_id AND (c.company_id IS NULL OR c.company_id = company_id)
    ))
    AND (lead_id IS NULL OR EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = lead_id AND (l.company_id IS NULL OR l.company_id = company_id)
    ))
  );

DROP POLICY IF EXISTS job_cards_update ON public.job_cards;
CREATE POLICY job_cards_update ON public.job_cards
  FOR UPDATE TO authenticated
  USING (company_id = public.caller_company_id())
  WITH CHECK (
    company_id = public.caller_company_id()
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.company_id = company_id)
    AND (customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_id AND (c.company_id IS NULL OR c.company_id = company_id)
    ))
    AND (lead_id IS NULL OR EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = lead_id AND (l.company_id IS NULL OR l.company_id = company_id)
    ))
  );

DROP TRIGGER IF EXISTS job_cards_set_updated_at ON public.job_cards;
CREATE TRIGGER job_cards_set_updated_at
  BEFORE UPDATE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Private bucket. Path is {company}/{job}/job-card.pdf. Same company only.
CREATE OR REPLACE FUNCTION public.job_card_storage_ok(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.caller_company_id() IS NOT NULL
    AND split_part(_name, '/', 1) = public.caller_company_id()::text
    AND split_part(_name, '/', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    AND split_part(_name, '/', 3) = 'job-card.pdf'
    AND split_part(_name, '/', 4) = ''
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = split_part(_name, '/', 2)::uuid
        AND j.company_id = public.caller_company_id()
    );
$$;

REVOKE ALL ON FUNCTION public.job_card_storage_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_card_storage_ok(text) TO authenticated;

DO $pol$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public)
  SELECT 'job-cards', 'job-cards', false
  WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'job-cards');
  UPDATE storage.buckets SET public = false WHERE id = 'job-cards';

  EXECUTE 'DROP POLICY IF EXISTS job_cards_storage_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS job_cards_storage_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS job_cards_storage_update ON storage.objects';
  EXECUTE 'CREATE POLICY job_cards_storage_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''job-cards'' AND public.job_card_storage_ok(name))';
  EXECUTE 'CREATE POLICY job_cards_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''job-cards'' AND public.job_card_storage_ok(name))';
  EXECUTE 'CREATE POLICY job_cards_storage_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''job-cards'' AND public.job_card_storage_ok(name)) WITH CHECK (bucket_id = ''job-cards'' AND public.job_card_storage_ok(name))';
END $pol$;
