-- Site Survey phase 2 (18 Oct 2026): survey tables + private company-scoped bucket.
-- Visibility follows leads RLS (company scope, rep scope, tech scope) via caller_sees_lead (SECURITY INVOKER).
-- Techs are read-only. No public storage rules.

CREATE TABLE IF NOT EXISTS public.site_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete')),
  report_no text UNIQUE,
  access_note text,
  access_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  lat double precision,
  lng double precision,
  address_confirmed_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS site_surveys_one_live_per_lead ON public.site_surveys(lead_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS site_surveys_company_idx ON public.site_surveys(company_id);
CREATE INDEX IF NOT EXISTS site_surveys_quote_idx ON public.site_surveys(quote_id);

CREATE TABLE IF NOT EXISTS public.site_survey_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.site_surveys(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  sort int NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT 'Room',
  unit_size_btu int,
  pipe_run_m numeric(5,1),
  wall_type text,
  electrical text,
  floor_level text,
  core_holes int,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_survey_rooms_survey_idx ON public.site_survey_rooms(survey_id);

CREATE TABLE IF NOT EXISTS public.site_survey_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.site_surveys(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.site_survey_rooms(id) ON DELETE CASCADE,
  parent_media_id uuid REFERENCES public.site_survey_media(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  kind text NOT NULL CHECK (kind IN ('front','indoor','outdoor','other','audio')),
  storage_path text,
  annotated_path text,
  annotation jsonb,
  caption text,
  transcript text,
  transcript_status text NOT NULL DEFAULT 'none' CHECK (transcript_status IN ('none','pending','done','failed')),
  duration_s numeric(6,1),
  bytes int,
  sort int NOT NULL DEFAULT 0,
  taken_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  audio_purged_at timestamptz,
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS site_survey_media_survey_idx ON public.site_survey_media(survey_id);

-- company_id is always forced from the lead / parent survey (never trusted from the client)
CREATE OR REPLACE FUNCTION public.ss_fill_company() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF TG_TABLE_NAME = 'site_surveys' THEN
    SELECT l.company_id INTO NEW.company_id FROM public.leads l WHERE l.id = NEW.lead_id;
    IF TG_OP = 'UPDATE' THEN NEW.created_by := OLD.created_by; NEW.lead_id := OLD.lead_id; NEW.company_id := OLD.company_id; END IF;
  ELSE
    SELECT s.company_id INTO NEW.company_id FROM public.site_surveys s WHERE s.id = NEW.survey_id;
    IF TG_OP = 'UPDATE' THEN NEW.survey_id := OLD.survey_id; NEW.company_id := OLD.company_id; END IF;
  END IF;
  IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'site survey: company not found' USING ERRCODE = '23502'; END IF;
  IF TG_TABLE_NAME <> 'site_survey_media' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS ss_fill_company ON public.site_surveys;
CREATE TRIGGER ss_fill_company BEFORE INSERT OR UPDATE ON public.site_surveys FOR EACH ROW EXECUTE FUNCTION public.ss_fill_company();
DROP TRIGGER IF EXISTS ss_fill_company ON public.site_survey_rooms;
CREATE TRIGGER ss_fill_company BEFORE INSERT OR UPDATE ON public.site_survey_rooms FOR EACH ROW EXECUTE FUNCTION public.ss_fill_company();
DROP TRIGGER IF EXISTS ss_fill_company ON public.site_survey_media;
CREATE TRIGGER ss_fill_company BEFORE INSERT OR UPDATE ON public.site_survey_media FOR EACH ROW EXECUTE FUNCTION public.ss_fill_company();

-- report number SS-YYYY-NNN per company, given when the survey is first completed
CREATE OR REPLACE FUNCTION public.ss_report_no() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE y text := to_char(now() AT TIME ZONE 'Africa/Johannesburg', 'YYYY'); n int;
BEGIN
  IF NEW.status = 'complete' AND NEW.report_no IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('ss_report_no' || NEW.company_id::text));
    SELECT COALESCE(max(substring(report_no from '\d+$')::int), 0) + 1 INTO n
      FROM public.site_surveys WHERE company_id = NEW.company_id AND report_no LIKE 'SS-' || y || '-%';
    NEW.report_no := 'SS-' || y || '-' || lpad(n::text, 3, '0');
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS ss_report_no ON public.site_surveys;
CREATE TRIGGER ss_report_no BEFORE INSERT OR UPDATE ON public.site_surveys FOR EACH ROW EXECUTE FUNCTION public.ss_report_no();

-- who may edit a survey: not a tech-only user, same company, can see the lead; reps only their own survey
CREATE OR REPLACE FUNCTION public.ss_can_write(_survey uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $f$
  SELECT auth.uid() IS NOT NULL AND NOT public.is_field_tech_only(auth.uid())
    AND EXISTS (SELECT 1 FROM public.site_surveys s WHERE s.id = _survey
                AND s.company_id = public.caller_company_id()
                AND public.caller_sees_lead(s.lead_id)
                AND (NOT public.is_sales_rep(auth.uid()) OR s.created_by = auth.uid())) $f$;
GRANT EXECUTE ON FUNCTION public.ss_can_write(uuid) TO authenticated;

ALTER TABLE public.site_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_survey_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_survey_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_surveys, public.site_survey_rooms, public.site_survey_media FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_surveys, public.site_survey_rooms, public.site_survey_media TO authenticated;

-- surveys
DROP POLICY IF EXISTS ss_select ON public.site_surveys;
CREATE POLICY ss_select ON public.site_surveys FOR SELECT TO authenticated
  USING (public.caller_sees_lead(lead_id) AND (company_id = public.caller_company_id() OR public.p4_is_platform()));
DROP POLICY IF EXISTS ss_insert ON public.site_surveys;
CREATE POLICY ss_insert ON public.site_surveys FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND NOT public.is_field_tech_only(auth.uid())
              AND public.caller_sees_lead(lead_id)
              AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.company_id = public.caller_company_id()));
DROP POLICY IF EXISTS ss_update ON public.site_surveys;
CREATE POLICY ss_update ON public.site_surveys FOR UPDATE TO authenticated
  USING (public.ss_can_write(id)) WITH CHECK (company_id = public.caller_company_id());
DROP POLICY IF EXISTS ss_delete ON public.site_surveys;
CREATE POLICY ss_delete ON public.site_surveys FOR DELETE TO authenticated
  USING (status = 'draft' AND public.ss_can_write(id));

-- rooms + media follow the parent survey
DROP POLICY IF EXISTS ssr_select ON public.site_survey_rooms;
CREATE POLICY ssr_select ON public.site_survey_rooms FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.site_surveys s WHERE s.id = survey_id));
DROP POLICY IF EXISTS ssr_write ON public.site_survey_rooms;
CREATE POLICY ssr_write ON public.site_survey_rooms FOR ALL TO authenticated
  USING (public.ss_can_write(survey_id)) WITH CHECK (public.ss_can_write(survey_id));
DROP POLICY IF EXISTS ssm_select ON public.site_survey_media;
CREATE POLICY ssm_select ON public.site_survey_media FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.site_surveys s WHERE s.id = survey_id));
DROP POLICY IF EXISTS ssm_write ON public.site_survey_media;
CREATE POLICY ssm_write ON public.site_survey_media FOR ALL TO authenticated
  USING (public.ss_can_write(survey_id)) WITH CHECK (public.ss_can_write(survey_id));

-- storage: private bucket, path {company_id}/{survey_id}/{file}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-surveys', 'site-surveys', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','audio/wav','audio/x-wav','audio/mp4','audio/webm','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE OR REPLACE FUNCTION public.ss_folder_survey(_name text) RETURNS uuid
 LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT CASE WHEN (storage.foldername(_name))[1] ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
               AND (storage.foldername(_name))[2] ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
              THEN ((storage.foldername(_name))[2])::uuid END $f$;
CREATE OR REPLACE FUNCTION public.ss_folder_ok(_name text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.site_surveys s
                 WHERE s.id = public.ss_folder_survey(_name)
                   AND s.company_id::text = (storage.foldername(_name))[1]) $f$;
GRANT EXECUTE ON FUNCTION public.ss_folder_survey(text), public.ss_folder_ok(text) TO authenticated;

DROP POLICY IF EXISTS ss_obj_select ON storage.objects;
CREATE POLICY ss_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-surveys' AND public.ss_folder_ok(name));
DROP POLICY IF EXISTS ss_obj_insert ON storage.objects;
CREATE POLICY ss_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-surveys' AND public.ss_folder_ok(name) AND public.ss_can_write(public.ss_folder_survey(name)));
DROP POLICY IF EXISTS ss_obj_update ON storage.objects;
CREATE POLICY ss_obj_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'site-surveys' AND public.ss_can_write(public.ss_folder_survey(name)))
  WITH CHECK (bucket_id = 'site-surveys' AND public.ss_folder_ok(name) AND public.ss_can_write(public.ss_folder_survey(name)));
DROP POLICY IF EXISTS ss_obj_delete ON storage.objects;
CREATE POLICY ss_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-surveys' AND public.ss_can_write(public.ss_folder_survey(name)));
