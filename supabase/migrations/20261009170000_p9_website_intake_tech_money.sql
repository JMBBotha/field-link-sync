-- P9 (Johan 2026-10-09 13:11): website intake -> 0800-BE-COOL; techs can't read company_settings money.
CREATE SCHEMA IF NOT EXISTS backup_p9_20261009;
CREATE TABLE IF NOT EXISTS backup_p9_20261009.admin_settings AS SELECT * FROM public.admin_settings;
CREATE TABLE IF NOT EXISTS backup_p9_20261009.company_settings AS SELECT * FROM public.company_settings;
CREATE TABLE IF NOT EXISTS backup_p9_20261009.cs_policies AS SELECT * FROM pg_policies WHERE tablename='company_settings';

-- (2) website intake company (read by receive-website-lead / ingest-lead website_form only)
INSERT INTO public.admin_settings(setting_key, setting_value)
SELECT 'website_lead_company_id', to_jsonb('361bf031-9cdb-4d7f-9bde-9eb95fa4725e'::text)
WHERE NOT EXISTS (SELECT 1 FROM public.admin_settings WHERE setting_key='website_lead_company_id');

-- (3) techs (field-agent only, not ops/admin) cannot select company_settings rows at all
DROP POLICY IF EXISTS p9_cs_no_techs ON public.company_settings;
CREATE POLICY p9_cs_no_techs ON public.company_settings AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.is_field_tech_only(auth.uid()));

-- safe, money-free company profile for any signed-in member of the caller's company
CREATE OR REPLACE FUNCTION public.company_profile_safe()
RETURNS TABLE(company_id uuid, company_name text, vat_number text, physical_address text, postal_address text,
              office_address text, logo_storage_path text, logo_url text,
              default_deposit_percentage numeric, default_payment_terms_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, COALESCE(NULLIF(cs.company_name,''), c.name), cs.vat_number, cs.physical_address, cs.postal_address,
         c.office_address, cs.logo_storage_path, c.logo_url,
         cs.default_deposit_percentage::numeric, cs.default_payment_terms_days::integer
  FROM public.profiles p
  JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN LATERAL (SELECT * FROM public.company_settings s WHERE s.company_id = c.id
                     ORDER BY s.updated_at DESC LIMIT 1) cs ON true
  WHERE p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.company_profile_safe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_profile_safe() TO authenticated;
