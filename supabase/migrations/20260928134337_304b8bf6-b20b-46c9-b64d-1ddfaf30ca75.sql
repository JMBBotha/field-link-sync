ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS custom_service_limit int NOT NULL DEFAULT 5;

CREATE TABLE public.catalog_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  sort_order int,
  origin text NOT NULL DEFAULT 'custom' CHECK (origin IN ('core','custom')),
  owner_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  search_aliases text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  promoted_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_services TO authenticated;
GRANT ALL ON public.catalog_services TO service_role;
ALTER TABLE public.catalog_services ENABLE ROW LEVEL SECURITY;
CREATE INDEX catalog_services_owner_idx ON public.catalog_services(owner_company_id, origin, is_active);

CREATE TRIGGER catalog_services_touch BEFORE UPDATE ON public.catalog_services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_custom_service_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit int; v_count int;
BEGIN
  IF NEW.origin <> 'custom' OR NOT NEW.is_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.origin = 'custom' AND OLD.is_active AND OLD.owner_company_id = NEW.owner_company_id THEN RETURN NEW; END IF;
  SELECT custom_service_limit INTO v_limit FROM public.companies WHERE id = NEW.owner_company_id;
  SELECT count(*) INTO v_count FROM public.catalog_services
    WHERE owner_company_id = NEW.owner_company_id AND origin = 'custom' AND is_active AND id <> NEW.id;
  IF v_count >= coalesce(v_limit, 5) THEN RAISE EXCEPTION 'CUSTOM_LIMIT_REACHED'; END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.enforce_custom_service_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER catalog_services_custom_limit BEFORE INSERT OR UPDATE ON public.catalog_services
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_service_limit();

CREATE POLICY "Read core services" ON public.catalog_services FOR SELECT TO authenticated
  USING (origin = 'core' AND public.can_read_master_catalog(auth.uid()));
CREATE POLICY "Read own custom services" ON public.catalog_services FOR SELECT TO authenticated
  USING (origin = 'custom' AND owner_company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Master admins manage services" ON public.catalog_services FOR ALL TO authenticated
  USING (public.can_write_master_catalog(auth.uid())) WITH CHECK (public.can_write_master_catalog(auth.uid()));
CREATE POLICY "Network companies add custom services" ON public.catalog_services FOR INSERT TO authenticated
  WITH CHECK (origin = 'custom' AND owner_company_id = public.get_user_company_id(auth.uid()) AND public.can_read_master_catalog(auth.uid()));
CREATE POLICY "Companies update own custom services" ON public.catalog_services FOR UPDATE TO authenticated
  USING (origin = 'custom' AND owner_company_id = public.get_user_company_id(auth.uid()))
  WITH CHECK (origin = 'custom' AND owner_company_id = public.get_user_company_id(auth.uid()) AND promoted_at IS NULL);
CREATE POLICY "Companies delete own custom services" ON public.catalog_services FOR DELETE TO authenticated
  USING (origin = 'custom' AND owner_company_id = public.get_user_company_id(auth.uid()));

INSERT INTO public.catalog_services (name, description, sort_order, origin, owner_company_id, search_aliases) VALUES
 ('Removal of existing air conditioner', 'Description pending', 1, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Removal and reinstallation of existing air conditioner', 'Description pending', 2, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Installation of quoted air conditioner', 'Description pending', 3, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Repair of existing air conditioner or system', 'Description pending', 4, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Replacement of indoor or outdoor PC boards', 'Description pending', 5, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Isolator or electrical fault repair', 'Description pending', 6, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Service of ducted, cassette and under ceiling systems', 'Description pending', 7, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Service of split wall units', 'Description pending', 8, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 -- Package unit: the unit type goes in the line description, not in separate entries.
 ('Package unit', 'Description pending', 9, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', NULL),
 ('Installation of under ceiling, cassette and hideaway systems', 'Description pending', 10, 'core', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', ARRAY['ducted']);

COMMENT ON TABLE public.catalog_services IS 'Master service catalogue. Core rows owned by the master company; custom rows by the contractor company (capped by companies.custom_service_limit). ''Package unit'': the unit type goes in the line description, not in separate entries. ''Hideaway'' = ducted.';