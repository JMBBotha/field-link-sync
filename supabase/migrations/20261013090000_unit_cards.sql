-- Quote unit cards (Johan approved 13 Oct 08:32). Additive only.
-- product_media: company-agnostic model content (image cut-out, specs, bullets, feature highlight), draft -> approved.
CREATE OR REPLACE FUNCTION public.normalize_model_code(p text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT NULLIF(regexp_replace(regexp_replace(upper(coalesce(p,'')), '\s+', '', 'g'), '-DUP\d*$', ''), '')
$f$;

CREATE TABLE IF NOT EXISTS public.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key text NOT NULL UNIQUE,
  model_code text NOT NULL,
  brand text,
  family text,
  display_name text,
  subtitle text,
  image_path text,
  image_url text,
  image_source_url text,
  image_status text NOT NULL DEFAULT 'none' CHECK (image_status IN ('ready','needs_cutout','none')),
  product_url text,
  support_url text,
  source_label text,
  bullets text[] NOT NULL DEFAULT '{}',
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_highlight jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','failed')),
  fetch_error text,
  notes text,
  fetched_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_media_key_normalised CHECK (model_key = public.normalize_model_code(model_key))
);
CREATE INDEX IF NOT EXISTS idx_product_media_status ON public.product_media(status);

ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_media approved readable" ON public.product_media;
CREATE POLICY "product_media approved readable" ON public.product_media FOR SELECT TO anon, authenticated USING (status = 'approved');
DROP POLICY IF EXISTS "product_media owner read all" ON public.product_media;
CREATE POLICY "product_media owner read all" ON public.product_media FOR SELECT TO authenticated USING (public.is_platform_owner());
DROP POLICY IF EXISTS "product_media owner write" ON public.product_media;
CREATE POLICY "product_media owner write" ON public.product_media FOR ALL TO authenticated USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());

CREATE OR REPLACE FUNCTION public.product_media_touch() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN NEW.updated_at := now(); NEW.model_key := public.normalize_model_code(NEW.model_key); RETURN NEW; END $f$;
DROP TRIGGER IF EXISTS trg_product_media_touch ON public.product_media;
CREATE TRIGGER trg_product_media_touch BEFORE INSERT OR UPDATE ON public.product_media FOR EACH ROW EXECUTE FUNCTION public.product_media_touch();

-- Notify Massair admins when a new draft lands (approve on Admin > Unit content).
CREATE OR REPLACE FUNCTION public.product_media_notify_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.status = 'draft' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'draft') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    SELECT DISTINCT ur.user_id, 'unit_content_draft', 'Unit card to approve: ' || NEW.model_code,
           'New product content was fetched. Review and approve it under Admin > Unit content.', NEW.id
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::app_role AND public.get_user_company_id(ur.user_id) = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::uuid;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_product_media_notify ON public.product_media;
CREATE TRIGGER trg_product_media_notify AFTER INSERT OR UPDATE OF status ON public.product_media FOR EACH ROW EXECUTE FUNCTION public.product_media_notify_draft();

-- Per-quote toggle (default on).
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS show_unit_cards boolean NOT NULL DEFAULT true;

-- Client link: is the unit-cards section on for this quote? (anon-safe, token only)
CREATE OR REPLACE FUNCTION public.public_quote_show_unit_cards(p_token uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE((SELECT q.show_unit_cards FROM public.quotes q WHERE q.public_token = p_token), false)
$f$;
GRANT EXECUTE ON FUNCTION public.public_quote_show_unit_cards(uuid) TO anon, authenticated;

-- Storage: our own public bucket for cut-out images (never hotlink).
INSERT INTO storage.buckets (id, name, public) VALUES ('product-media', 'product-media', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "product-media public read" ON storage.objects;
CREATE POLICY "product-media public read" ON storage.objects FOR SELECT USING (bucket_id = 'product-media');
DROP POLICY IF EXISTS "product-media owner write" ON storage.objects;
CREATE POLICY "product-media owner write" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'product-media' AND public.is_platform_owner())
  WITH CHECK (bucket_id = 'product-media' AND public.is_platform_owner());
