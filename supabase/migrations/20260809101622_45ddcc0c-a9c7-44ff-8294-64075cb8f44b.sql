
-- ENUMS
DO $$ BEGIN CREATE TYPE public.lead_source AS ENUM ('vapi_call','website_form','facebook_lead_ads','google_lsa','manual','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lead_intent AS ENUM ('sales','service'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lead_classifier AS ENUM ('rule','ai','human'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lead_priority_level AS ENUM ('emergency','same_day','standard'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.lead_lifecycle_status AS ENUM ('new','classified','routed','in_progress','completed','lost','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- LEADS COLUMNS
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source public.lead_source NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS normalized_address text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merge_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS interaction_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS intents text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_intent public.lead_intent,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS classified_by public.lead_classifier,
  ADD COLUMN IF NOT EXISTS lead_priority public.lead_priority_level NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS lead_score integer,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_status public.lead_lifecycle_status NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT leads_lead_score_range CHECK (lead_score IS NULL OR (lead_score BETWEEN 1 AND 5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- IDEMPOTENCY + DEDUP INDEXES
CREATE UNIQUE INDEX IF NOT EXISTS leads_idempotency_key_uidx
  ON public.leads (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_external_id_uidx
  ON public.leads (source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_active_phone_uidx
  ON public.leads (company_id, phone) WHERE phone IS NOT NULL AND merged_into_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_active_email_uidx
  ON public.leads (company_id, lower(email)) WHERE email IS NOT NULL AND merged_into_id IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_norm_address_idx ON public.leads (normalized_address) WHERE normalized_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_company_name_idx ON public.leads (lower(company_name)) WHERE company_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_last_activity_idx ON public.leads (last_activity_at DESC);

-- DEAD LETTER QUEUE
CREATE TABLE IF NOT EXISTS public.webhook_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  stage text NOT NULL DEFAULT 'ingestion',
  idempotency_key text,
  external_id text,
  payload jsonb,
  error_message text,
  error_detail jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.webhook_dead_letters TO authenticated;
GRANT ALL ON public.webhook_dead_letters TO service_role;
ALTER TABLE public.webhook_dead_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read dead letters" ON public.webhook_dead_letters;
CREATE POLICY "Admins read dead letters" ON public.webhook_dead_letters
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- STATUS CHANGE AUDIT
CREATE TABLE IF NOT EXISTS public.status_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field_name text NOT NULL DEFAULT 'status',
  old_status text,
  new_status text,
  changed_by uuid,
  company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.status_change_log TO authenticated;
GRANT ALL ON public.status_change_log TO service_role;
ALTER TABLE public.status_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Company members read status log" ON public.status_change_log;
CREATE POLICY "Company members read status log" ON public.status_change_log
  FOR SELECT TO authenticated
  USING (company_id IS NOT NULL AND company_id = public.get_user_company_id(auth.uid()));
CREATE INDEX IF NOT EXISTS status_change_log_entity_idx ON public.status_change_log (entity_type, entity_id, created_at DESC);

-- TRIGGER: log lead status changes + touch last_activity_at
CREATE OR REPLACE FUNCTION public.log_lead_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.last_activity_at := now();

  IF TG_OP = 'UPDATE' AND OLD.lead_status IS DISTINCT FROM NEW.lead_status THEN
    INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
    VALUES ('lead', NEW.id, 'lead_status', OLD.lead_status::text, NEW.lead_status::text, auth.uid(), NEW.company_id);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
    VALUES ('lead', NEW.id, 'status', OLD.status, NEW.status, auth.uid(), NEW.company_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_lead_status_change ON public.leads;
CREATE TRIGGER trg_log_lead_status_change
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.log_lead_status_change();

CREATE OR REPLACE FUNCTION public.set_updated_at_dead_letters()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_dead_letters_updated_at ON public.webhook_dead_letters;
CREATE TRIGGER trg_dead_letters_updated_at BEFORE UPDATE ON public.webhook_dead_letters
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_dead_letters();
