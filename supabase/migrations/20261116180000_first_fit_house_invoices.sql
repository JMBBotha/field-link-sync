-- First fit complete, house photos, and the two Cape Estates issue dates.
-- Preview only until Johan says go. Do not apply this to the live database from the pull request.
-- Nothing here sends, emails, or WhatsApps a quote or an invoice.
-- Existing invoice amounts, numbers, statuses, and payments are not updated.
-- Undo: supabase/manual/20261116180000_first_fit_house_invoices_rollback.sql

-- ---------------------------------------------------------------------------
-- Job photos: company on the row, and {company}/{lead}/{file} going forward.
-- Old objects stay at {lead}/{file}. Signed URLs keep using the stored path.
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_photos
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

UPDATE public.job_photos p
SET company_id = l.company_id
FROM public.leads l
WHERE p.lead_id = l.id AND p.company_id IS NULL AND l.company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_photos_company_idx ON public.job_photos (company_id);

CREATE OR REPLACE FUNCTION public.job_photos_set_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT l.company_id INTO co FROM public.leads l WHERE l.id = NEW.lead_id;
    IF co IS NOT NULL THEN
      IF auth.uid() IS NOT NULL
         AND public.caller_company_id() IS NOT NULL
         AND co IS DISTINCT FROM public.caller_company_id() THEN
        RAISE EXCEPTION 'Photo company does not match the lead' USING ERRCODE = '42501';
      END IF;
      NEW.company_id := co;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS job_photos_set_company_t ON public.job_photos;
CREATE TRIGGER job_photos_set_company_t
  BEFORE INSERT OR UPDATE ON public.job_photos
  FOR EACH ROW EXECUTE FUNCTION public.job_photos_set_company();

DROP POLICY IF EXISTS job_photos_company_scope ON public.job_photos;
CREATE POLICY job_photos_company_scope ON public.job_photos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id IS NULL OR company_id = public.caller_company_id())
  WITH CHECK (company_id IS NULL OR company_id = public.caller_company_id());

-- First folder is the lead on old paths. On new paths the lead is the second folder.
CREATE OR REPLACE FUNCTION public.photo_folder_lead(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN split_part(_name, '/', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
     AND split_part(_name, '/', 3) <> ''
      THEN split_part(_name, '/', 2)::uuid
    WHEN split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      THEN split_part(_name, '/', 1)::uuid
    ELSE NULL
  END
$f$;

CREATE OR REPLACE FUNCTION public.job_photo_path_company_ok(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN public.caller_company_id() IS NULL THEN false
    WHEN split_part(_name, '/', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
     AND split_part(_name, '/', 3) <> ''
      THEN split_part(_name, '/', 1) = public.caller_company_id()::text
    ELSE true
  END
$f$;
REVOKE ALL ON FUNCTION public.job_photo_path_company_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_photo_path_company_ok(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rh_photo_ok(_name text, _owner text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN public.photo_folder_lead(_name) IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = public.photo_folder_lead(_name))
    THEN EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = public.photo_folder_lead(_name)
        AND l.company_id = public.caller_company_id()
        AND public.job_photo_path_company_ok(_name)
        AND (NOT public.is_field_tech_only(auth.uid()) OR public.tech_can_see_lead(auth.uid(), l.id))
    )
    ELSE _owner = auth.uid()::text
      OR (
        NOT public.is_field_tech_only(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id::text = _owner AND p.company_id = public.caller_company_id()
        )
      )
  END
$f$;

DROP POLICY IF EXISTS "p2_photos_insert" ON public.job_photos;
CREATE POLICY "p2_photos_insert" ON public.job_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    (uploaded_by IS NULL OR uploaded_by = auth.uid())
    AND public.photo_lead_ok(lead_id)
    AND (company_id IS NULL OR company_id = public.caller_company_id())
  );

DROP POLICY IF EXISTS "p2_photos_delete" ON public.job_photos;
CREATE POLICY "p2_photos_delete" ON public.job_photos
  FOR DELETE TO authenticated
  USING (public.photo_lead_ok(lead_id));

DROP POLICY IF EXISTS "p2_photos_update" ON public.job_photos;
CREATE POLICY "p2_photos_update" ON public.job_photos
  FOR UPDATE TO authenticated
  USING (public.photo_lead_ok(lead_id))
  WITH CHECK (
    public.photo_lead_ok(lead_id)
    AND (company_id IS NULL OR company_id = public.caller_company_id())
  );

-- ---------------------------------------------------------------------------
-- House photos, unit lists, first-fit points, client issue settings.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_house_id uuid NOT NULL REFERENCES public.project_houses(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text,
  photo_type text NOT NULL DEFAULT 'site' CHECK (photo_type IN ('site', 'first_fit')),
  uploaded_by uuid,
  taken_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'walda')),
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS house_photos_source_ref
  ON public.house_photos (company_id, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS house_photos_house_idx ON public.house_photos (project_house_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_house_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_house_id uuid NOT NULL REFERENCES public.project_houses(id) ON DELETE CASCADE,
  area text NOT NULL,
  unit_size text NOT NULL CHECK (unit_size IN ('9K', '12K', '18K', '24K')),
  catalogue_product_id uuid,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_house_units_area_uniq UNIQUE (project_house_id, area)
);

CREATE TABLE IF NOT EXISTS public.first_fit_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_house_id uuid NOT NULL REFERENCES public.project_houses(id) ON DELETE CASCADE,
  area text NOT NULL,
  unit_size text NOT NULL CHECK (unit_size IN ('9K', '12K', '18K', '24K')),
  pipe_m numeric NOT NULL CHECK (pipe_m > 0 AND pipe_m <= 200),
  storage_path text NOT NULL,
  caption text,
  taken_by uuid,
  taken_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('app', 'walda')),
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_fit_points_area_chk CHECK (btrim(area) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS first_fit_points_source_ref
  ON public.first_fit_points (company_id, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS first_fit_points_house_idx ON public.first_fit_points (project_house_id, taken_at);

CREATE TABLE IF NOT EXISTS public.client_issue_settings (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  deposit_days int NOT NULL DEFAULT 45 CHECK (deposit_days BETWEEN 0 AND 365),
  balance_days int NOT NULL DEFAULT 60 CHECK (balance_days BETWEEN 0 AND 730),
  issue_snap_day int CHECK (issue_snap_day BETWEEN 1 AND 28),
  prepare_days int NOT NULL DEFAULT 7 CHECK (prepare_days BETWEEN 0 AND 60),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.client_issue_settings (
  customer_id, company_id, deposit_days, balance_days, issue_snap_day, prepare_days, discount_percent
)
SELECT '3dde87f5-60cf-5cda-bc54-edd8b0e553cc', '361bf031-9cdb-4d7f-9bde-9eb95fa4725e', 45, 60, 15, 7, 5
WHERE EXISTS (
  SELECT 1 FROM public.customers c
  WHERE c.id = '3dde87f5-60cf-5cda-bc54-edd8b0e553cc'
    AND c.company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
)
ON CONFLICT (customer_id) DO NOTHING;

ALTER TABLE public.project_houses
  ADD COLUMN IF NOT EXISTS first_fit_complete_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_fit_complete_by uuid,
  ADD COLUMN IF NOT EXISTS first_fit_undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_fit_undone_by uuid,
  ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_due_on date,
  ADD COLUMN IF NOT EXISTS balance_due_on date,
  ADD COLUMN IF NOT EXISTS balance_estimated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_fit_hash text;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS project_house_id uuid REFERENCES public.project_houses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS review_flag text,
  ADD COLUMN IF NOT EXISTS first_fit_edited boolean NOT NULL DEFAULT false;

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_origin_chk;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_origin_chk CHECK (origin IS NULL OR origin = 'first_fit');

CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_first_fit
  ON public.quotes (project_house_id)
  WHERE origin = 'first_fit' AND archived_at IS NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issue_stage text,
  ADD COLUMN IF NOT EXISTS review_flag text,
  ADD COLUMN IF NOT EXISTS prep_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sibling_invoice_id uuid;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issue_stage_chk;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_issue_stage_chk CHECK (issue_stage IS NULL OR issue_stage IN ('deposit', 'balance'));

CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_issue_stage
  ON public.invoices (project_house_id, issue_stage)
  WHERE issue_stage IS NOT NULL
    AND coalesce(status, '') NOT IN ('void', 'cancelled')
    AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Who may tap, and the date rules (Johannesburg).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._first_fit_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.caller_company_id() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'dispatcher'::app_role)
      OR public.has_role(auth.uid(), 'field_agent'::app_role)
      OR public.is_field_tech_only(auth.uid())
    );
$$;
REVOKE ALL ON FUNCTION public._first_fit_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._first_fit_staff() TO authenticated;

CREATE OR REPLACE FUNCTION public._first_fit_office()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.caller_company_id() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'dispatcher'::app_role)
    )
    AND NOT public.is_field_tech_only(auth.uid());
$$;
REVOKE ALL ON FUNCTION public._first_fit_office() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._first_fit_office() TO authenticated;

CREATE OR REPLACE FUNCTION public._issue_today()
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('app.backfill', true) = '1'
     AND current_setting('app.today', true) ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN current_setting('app.today', true)::date;
  END IF;
  RETURN (now() AT TIME ZONE 'Africa/Johannesburg')::date;
END $$;
REVOKE ALL ON FUNCTION public._issue_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._issue_today() TO authenticated;

CREATE OR REPLACE FUNCTION public.snap_on_or_after(p_on date, p_day int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  y int;
  m int;
  last_day int;
  snapped date;
BEGIN
  IF p_on IS NULL OR p_day IS NULL THEN
    RETURN p_on;
  END IF;
  y := EXTRACT(YEAR FROM p_on)::int;
  m := EXTRACT(MONTH FROM p_on)::int;
  last_day := EXTRACT(DAY FROM (date_trunc('month', p_on) + interval '1 month - 1 day'))::int;
  snapped := make_date(y, m, LEAST(p_day, last_day));
  IF snapped < p_on THEN
    snapped := (date_trunc('month', p_on) + interval '1 month')::date;
    y := EXTRACT(YEAR FROM snapped)::int;
    m := EXTRACT(MONTH FROM snapped)::int;
    last_day := EXTRACT(DAY FROM (date_trunc('month', snapped) + interval '1 month - 1 day'))::int;
    snapped := make_date(y, m, LEAST(p_day, last_day));
  END IF;
  RETURN snapped;
END $$;
REVOKE ALL ON FUNCTION public.snap_on_or_after(date, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snap_on_or_after(date, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_schedule_state(p_due date, p_today date, p_prepare int, p_estimated boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_due IS NULL OR p_today IS NULL THEN NULL
    WHEN p_estimated THEN 'estimated'
    WHEN p_today > p_due THEN 'overdue'
    WHEN p_today = p_due THEN 'due_today'
    WHEN p_today >= (p_due - GREATEST(coalesce(p_prepare, 0), 0)) THEN 'due_soon'
    ELSE 'upcoming'
  END
$$;
REVOKE ALL ON FUNCTION public.issue_schedule_state(date, date, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_schedule_state(date, date, int, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public._normalize_unit_size(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  s text := lower(regexp_replace(coalesce(p_raw, ''), '\s', '', 'g'));
BEGIN
  IF s IN ('9', '9k', '9btu', '9000', '9000btu') THEN RETURN '9K'; END IF;
  IF s IN ('12', '12k', '12btu', '12000', '12000btu') THEN RETURN '12K'; END IF;
  IF s IN ('18', '18k', '18btu', '18000', '18000btu') THEN RETURN '18K'; END IF;
  IF s IN ('24', '24k', '24btu', '24000', '24000btu') THEN RETURN '24K'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._normalize_unit_size(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._parse_pipe_m(p_raw text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  s text := lower(btrim(coalesce(p_raw, '')));
  n numeric;
BEGIN
  s := replace(s, ',', '.');
  s := regexp_replace(s, '\s', '', 'g');
  s := regexp_replace(s, 'm\.?$', '');
  IF s !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  n := round(s::numeric, 2);
  IF n <= 0 OR n > 200 THEN
    RETURN NULL;
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._parse_pipe_m(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._resolve_project_house(p_co uuid, p_house uuid, p_project uuid, p_house_no text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_n int;
  v_no text := nullif(btrim(p_house_no), '');
  v_prefix text;
  v_rest text;
BEGIN
  IF p_house IS NOT NULL THEN
    SELECT h.id INTO v_id
    FROM public.project_houses h
    WHERE h.id = p_house AND h.company_id = p_co;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
    END IF;
    RETURN v_id;
  END IF;
  IF v_no IS NULL THEN
    RAISE EXCEPTION 'Give the house id or the house number' USING ERRCODE = '22023';
  END IF;
  IF v_no ~* '^(avec|sv)\s+\S' THEN
    v_prefix := lower(split_part(v_no, ' ', 1));
    v_rest := btrim(regexp_replace(v_no, '^(avec|sv)\s+', '', 'i'));
  END IF;
  SELECT count(*) INTO v_n
  FROM public.project_houses h
  JOIN public.projects p ON p.id = h.project_id
  WHERE h.company_id = p_co
    AND (p_project IS NULL OR h.project_id = p_project)
    AND (
      h.house_no = v_no
      OR (v_rest IS NOT NULL AND h.house_no = v_rest AND (
        (v_prefix = 'avec' AND p.name ILIKE '%avec%')
        OR (v_prefix = 'sv' AND p.name ILIKE '%stellenbosch%')
      ))
    );
  IF v_n = 0 THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'More than one house matches that number' USING ERRCODE = '22023';
  END IF;
  SELECT h.id INTO v_id
  FROM public.project_houses h
  JOIN public.projects p ON p.id = h.project_id
  WHERE h.company_id = p_co
    AND (p_project IS NULL OR h.project_id = p_project)
    AND (
      h.house_no = v_no
      OR (v_rest IS NOT NULL AND h.house_no = v_rest AND (
        (v_prefix = 'avec' AND p.name ILIKE '%avec%')
        OR (v_prefix = 'sv' AND p.name ILIKE '%stellenbosch%')
      ))
    )
  LIMIT 1;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._resolve_project_house(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._issue_settings(p_customer uuid, p_company uuid)
RETURNS TABLE (deposit_days int, balance_days int, issue_snap_day int, prepare_days int, discount_percent numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(s.deposit_days, 45),
    COALESCE(s.balance_days, 60),
    s.issue_snap_day,
    COALESCE(s.prepare_days, 7),
    COALESCE(s.discount_percent, 0)
  FROM (SELECT 1) seed
  LEFT JOIN public.client_issue_settings s
    ON s.customer_id = p_customer AND s.company_id = p_company;
$$;
REVOKE ALL ON FUNCTION public._issue_settings(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Filing a point (app or WALDA). Same write. WALDA is gated by _walda_co.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._save_first_fit_point(
  p_co uuid,
  p_source text,
  p_house uuid,
  p_project uuid,
  p_house_no text,
  p_area text,
  p_unit_size text,
  p_pipe_m text,
  p_storage_path text,
  p_caption text,
  p_source_ref text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_house uuid;
  v_project uuid;
  v_area text;
  v_size text;
  v_pipe numeric;
  v_path text;
  v_cap text;
  v_ref text;
  v_list int;
  v_old public.first_fit_points%ROWTYPE;
  v_new public.first_fit_points%ROWTYPE;
  v_photo uuid;
  i int;
BEGIN
  IF NOT public.is_company_writable(p_co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  IF p_source NOT IN ('app', 'walda') THEN
    RAISE EXCEPTION 'Source is not allowed' USING ERRCODE = '22023';
  END IF;
  v_ref := nullif(btrim(p_source_ref), '');
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Source reference is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_ref) > 120 THEN
    RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023';
  END IF;
  v_house := public._resolve_project_house(p_co, p_house, p_project, p_house_no);
  SELECT h.project_id INTO v_project FROM public.project_houses h WHERE h.id = v_house;
  v_area := nullif(btrim(p_area), '');
  IF v_area IS NULL THEN
    RAISE EXCEPTION 'Area is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_area) > 80 THEN
    RAISE EXCEPTION 'Area is too long' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_list FROM public.project_house_units u WHERE u.project_house_id = v_house;
  IF v_list > 0 THEN
    SELECT u.area INTO v_area
    FROM public.project_house_units u
    WHERE u.project_house_id = v_house AND lower(btrim(u.area)) = lower(v_area)
    LIMIT 1;
    IF v_area IS NULL THEN
      RAISE EXCEPTION 'Area is not on this house' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_size := public._normalize_unit_size(p_unit_size);
  IF v_size IS NULL THEN
    RAISE EXCEPTION 'Unit size must be 9K, 12K, 18K or 24K' USING ERRCODE = '22023';
  END IF;
  v_pipe := public._parse_pipe_m(p_pipe_m);
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'Pipe metres must be more than 0 and at most 200' USING ERRCODE = '22023';
  END IF;
  v_path := nullif(btrim(p_storage_path), '');
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'Photo path is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_path) > 500 THEN
    RAISE EXCEPTION 'Photo path is too long' USING ERRCODE = '22023';
  END IF;
  IF split_part(v_path, '/', 1) IS DISTINCT FROM p_co::text
     OR split_part(v_path, '/', 2) IS DISTINCT FROM v_project::text
     OR split_part(v_path, '/', 3) IS DISTINCT FROM v_house::text THEN
    RAISE EXCEPTION 'Photo path must be in this company''s house-photos folder' USING ERRCODE = '22023';
  END IF;
  v_cap := nullif(btrim(p_caption), '');
  IF v_cap IS NOT NULL AND length(v_cap) > 500 THEN
    RAISE EXCEPTION 'Caption is too long' USING ERRCODE = '22023';
  END IF;

  FOR i IN 1..2 LOOP
    SELECT * INTO v_old
    FROM public.first_fit_points
    WHERE company_id = p_co AND source_ref = v_ref
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      IF v_old.project_house_id IS DISTINCT FROM v_house THEN
        RAISE EXCEPTION 'That source reference is already filed on another house' USING ERRCODE = '22023';
      END IF;
      IF v_old.area = v_area AND v_old.unit_size = v_size AND v_old.pipe_m = v_pipe
         AND v_old.storage_path = v_path AND v_old.caption IS NOT DISTINCT FROM v_cap THEN
        PERFORM public._bot_audit(p_co, 'first_fit_point_skipped', 'first_fit_points', v_old.id, to_jsonb(v_old), to_jsonb(v_old));
        RETURN jsonb_build_object(
          'result', 'skipped', 'id', v_old.id, 'house_id', v_house, 'area', v_old.area,
          'unit_size', v_old.unit_size, 'pipe_m', v_old.pipe_m, 'storage_path', v_old.storage_path, 'source', p_source
        );
      END IF;
      UPDATE public.first_fit_points
      SET area = v_area, unit_size = v_size, pipe_m = v_pipe, storage_path = v_path, caption = v_cap, source = p_source
      WHERE id = v_old.id
      RETURNING * INTO v_new;
      UPDATE public.house_photos
      SET storage_path = v_path, caption = v_cap, photo_type = 'first_fit', source = p_source
      WHERE company_id = p_co AND source_ref = v_ref;
      PERFORM public._bot_audit(p_co, 'first_fit_point_updated', 'first_fit_points', v_new.id, to_jsonb(v_old), to_jsonb(v_new));
      RETURN jsonb_build_object(
        'result', 'updated', 'id', v_new.id, 'house_id', v_house, 'area', v_new.area,
        'unit_size', v_new.unit_size, 'pipe_m', v_new.pipe_m, 'storage_path', v_new.storage_path, 'source', p_source
      );
    END IF;
    BEGIN
      INSERT INTO public.first_fit_points (
        company_id, project_house_id, area, unit_size, pipe_m, storage_path, caption, taken_by, source, source_ref
      ) VALUES (
        p_co, v_house, v_area, v_size, v_pipe, v_path, v_cap, auth.uid(), p_source, v_ref
      ) RETURNING * INTO v_new;
      INSERT INTO public.house_photos (
        company_id, project_house_id, storage_path, caption, photo_type, uploaded_by, source, source_ref
      ) VALUES (
        p_co, v_house, v_path, v_cap, 'first_fit', auth.uid(), p_source, v_ref
      ) RETURNING id INTO v_photo;
      PERFORM public._bot_audit(p_co, 'first_fit_point_inserted', 'first_fit_points', v_new.id, NULL, to_jsonb(v_new));
      RETURN jsonb_build_object(
        'result', 'inserted', 'id', v_new.id, 'photo_id', v_photo, 'house_id', v_house, 'area', v_new.area,
        'unit_size', v_new.unit_size, 'pipe_m', v_new.pipe_m, 'storage_path', v_new.storage_path, 'source', p_source
      );
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not file the first-fit point';
END $$;
REVOKE ALL ON FUNCTION public._save_first_fit_point(uuid, text, uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.walda_record_first_fit_point(
  p_house uuid DEFAULT NULL,
  p_project uuid DEFAULT NULL,
  p_house_no text DEFAULT NULL,
  p_area text DEFAULT NULL,
  p_unit_size text DEFAULT NULL,
  p_pipe_m text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_caption text DEFAULT NULL,
  p_source_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public._walda_co();
BEGIN
  RETURN public._save_first_fit_point(co, 'walda', p_house, p_project, p_house_no, p_area, p_unit_size, p_pipe_m, p_storage_path, p_caption, p_source_ref);
END $$;
REVOKE ALL ON FUNCTION public.walda_record_first_fit_point(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_first_fit_point(uuid, uuid, text, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_first_fit_point(
  p_house uuid DEFAULT NULL,
  p_project uuid DEFAULT NULL,
  p_house_no text DEFAULT NULL,
  p_area text DEFAULT NULL,
  p_unit_size text DEFAULT NULL,
  p_pipe_m text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_caption text DEFAULT NULL,
  p_source_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public._save_first_fit_point(co, 'app', p_house, p_project, p_house_no, p_area, p_unit_size, p_pipe_m, p_storage_path, p_caption, p_source_ref);
END $$;
REVOKE ALL ON FUNCTION public.record_first_fit_point(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_first_fit_point(uuid, uuid, text, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_house_photo(
  p_house uuid,
  p_storage_path text,
  p_caption text DEFAULT NULL,
  p_source_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  v_house uuid;
  v_project uuid;
  v_path text;
  v_cap text;
  v_ref text;
  v_id uuid;
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  v_house := public._resolve_project_house(co, p_house, NULL, NULL);
  SELECT project_id INTO v_project FROM public.project_houses WHERE id = v_house;
  v_path := nullif(btrim(p_storage_path), '');
  v_ref := nullif(btrim(p_source_ref), '');
  v_cap := nullif(btrim(p_caption), '');
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'Photo path is required' USING ERRCODE = '22023';
  END IF;
  IF split_part(v_path, '/', 1) IS DISTINCT FROM co::text
     OR split_part(v_path, '/', 2) IS DISTINCT FROM v_project::text
     OR split_part(v_path, '/', 3) IS DISTINCT FROM v_house::text THEN
    RAISE EXCEPTION 'Photo path must be in this company''s house-photos folder' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NOT NULL THEN
    SELECT id INTO v_id FROM public.house_photos WHERE company_id = co AND source_ref = v_ref;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('result', 'skipped', 'id', v_id, 'house_id', v_house);
    END IF;
  END IF;
  INSERT INTO public.house_photos (company_id, project_house_id, storage_path, caption, photo_type, uploaded_by, source, source_ref)
  VALUES (co, v_house, v_path, v_cap, 'site', auth.uid(), 'app', v_ref)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('result', 'inserted', 'id', v_id, 'house_id', v_house);
END $$;
REVOKE ALL ON FUNCTION public.record_house_photo(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_house_photo(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Draft quote (Samsung AR40H) and the two numbered draft invoices.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ar40h_unit(p_size text)
RETURNS TABLE (product_id uuid, item_name text, item_number text, unit_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lo int;
  v_hi int;
  v_label text;
BEGIN
  IF p_size = '9K' THEN v_lo := 8000; v_hi := 10999; v_label := '9\s?k|9000';
  ELSIF p_size = '12K' THEN v_lo := 11000; v_hi := 14999; v_label := '12\s?k|12000';
  ELSIF p_size = '18K' THEN v_lo := 15000; v_hi := 20999; v_label := '18\s?k|18000';
  ELSIF p_size = '24K' THEN v_lo := 21000; v_hi := 28000; v_label := '24\s?k|24000';
  ELSE RETURN; END IF;
  RETURN QUERY
  SELECT p.id,
    COALESCE(NULLIF(btrim(p.short_name), ''), NULLIF(btrim(p.name), ''), 'Samsung AR40H ' || p_size || ' wall unit'),
    NULLIF(btrim(p.product_code), ''),
    round(COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price_excl_vat, 0), 0), 2)
  FROM public.live_supplier_products p
  WHERE coalesce(p.archived, false) IS NOT TRUE
    AND coalesce(p.is_active, true) IS NOT FALSE
    AND (
      coalesce(p.model, '') ILIKE '%AR40H%'
      OR coalesce(p.product_code, '') ILIKE '%AR40H%'
      OR coalesce(p.short_name, '') ILIKE '%AR40H%'
      OR coalesce(p.name, '') ILIKE '%AR40H%'
      OR coalesce(p.model_range, '') ILIKE '%AR40%'
    )
    AND (
      coalesce(p.brand, '') ILIKE '%samsung%'
      OR coalesce(p.name, '') ILIKE '%samsung%'
      OR coalesce(p.model, '') ILIKE 'AR40%'
      OR coalesce(p.product_code, '') ILIKE '%AR40%'
    )
    AND coalesce(p.name, '') !~* 'cassette|ducted|duct '
    AND coalesce(p.product_type, '') !~* 'cassette|duct'
    AND coalesce(p.category, '') !~* 'cassette|duct'
    AND coalesce(p.product_category, '') !~* 'cassette|duct'
    AND (
      coalesce(p.capacity_btu, p.btu_rating, 0) BETWEEN v_lo AND v_hi
      OR (coalesce(p.name, '') || ' ' || coalesce(p.short_name, '') || ' ' || coalesce(p.model, '') || ' ' || coalesce(p.product_code, '')) ~* v_label
    )
  ORDER BY
    (coalesce(p.model, '') ILIKE '%AR40H%' OR coalesce(p.product_code, '') ILIKE '%AR40H%' OR coalesce(p.short_name, '') ILIKE '%AR40H%') DESC,
    (coalesce(p.name, '') ILIKE '%wall%') DESC,
    COALESCE(NULLIF(p.selling_price, 0), NULLIF(p.price_excl_vat, 0)) ASC NULLS LAST
  LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION public._ar40h_unit(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._points_hash(p_house uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT md5(coalesce(string_agg(
    lower(btrim(area)) || '|' || unit_size || '|' || pipe_m::text,
    ',' ORDER BY lower(btrim(area)), unit_size, pipe_m
  ), ''))
  FROM public.first_fit_points
  WHERE project_house_id = p_house;
$$;
REVOKE ALL ON FUNCTION public._points_hash(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._write_first_fit_quote(p_house uuid, p_co uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.project_houses%ROWTYPE;
  pr public.projects%ROWTYPE;
  v_customer text;
  q public.quotes%ROWTYPE;
  cfg record;
  grp record;
  prod record;
  v_area uuid;
  v_sort int := 0;
  v_sub numeric := 0;
  v_price numeric;
  v_name text;
  v_code text;
  v_pid uuid;
  v_needed boolean;
  v_disc numeric;
  v_vat numeric;
  v_total numeric;
  v_rate numeric;
  v_result text;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house AND company_id = p_co;
  SELECT * INTO pr FROM public.projects WHERE id = h.project_id;
  IF pr.customer_id IS NULL THEN
    RAISE EXCEPTION 'This project has no client' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cfg FROM public._issue_settings(pr.customer_id, p_co);
  SELECT c.name INTO v_customer FROM public.customers c WHERE c.id = pr.customer_id AND c.company_id = p_co;
  SELECT * INTO q
  FROM public.quotes
  WHERE project_house_id = p_house AND origin = 'first_fit' AND archived_at IS NULL
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF q.id IS NOT NULL AND (q.status IS DISTINCT FROM 'draft' OR q.sent_at IS NOT NULL) THEN
    UPDATE public.quotes
    SET review_flag = 'First fit was set again after this quote left draft — no second quote was opened.'
    WHERE id = q.id;
    RETURN jsonb_build_object('result', 'flagged', 'id', q.id, 'quote_number', q.quote_number);
  END IF;
  IF q.id IS NOT NULL AND q.first_fit_edited THEN
    UPDATE public.quotes
    SET review_flag = 'First fit data changed — review before sending. Edits were kept.'
    WHERE id = q.id;
    RETURN jsonb_build_object('result', 'flagged', 'id', q.id, 'quote_number', q.quote_number);
  END IF;

  PERFORM set_config('app.first_fit_write', '1', true);
  IF q.id IS NULL THEN
    INSERT INTO public.quotes (
      customer_id, company_id, sales_engineer_id, created_by, owner_id, status, quote_number,
      customer_name, discount_type, discount_value, vat_rate, notes, origin, project_house_id, review_flag, first_fit_edited
    ) VALUES (
      pr.customer_id, p_co, COALESCE(auth.uid(), (SELECT cm.user_id FROM public.company_members cm WHERE cm.company_id = p_co AND cm.role = 'admin' ORDER BY cm.created_at LIMIT 1)),
      auth.uid(),       auth.uid(), 'draft', public.generate_quote_number(),
      v_customer, CASE WHEN cfg.discount_percent > 0 THEN 'percent' ELSE 'none' END, cfg.discount_percent, 0.15,
      'First fit draft for house ' || h.house_no || '. Samsung AR40H wall units. Piping is R0 until a per-metre price is set. Not sent.',
      'first_fit', p_house, NULL, false
    ) RETURNING * INTO q;
    v_result := 'inserted';
  ELSE
    UPDATE public.quotes
    SET customer_id = pr.customer_id,
        customer_name = v_customer,
        discount_type = CASE WHEN cfg.discount_percent > 0 THEN 'percent' ELSE 'none' END,
        discount_value = cfg.discount_percent,
        review_flag = NULL,
        first_fit_edited = false,
        notes = 'First fit draft for house ' || h.house_no || '. Samsung AR40H wall units. Piping is R0 until a per-metre price is set. Not sent.'
    WHERE id = q.id
    RETURNING * INTO q;
    DELETE FROM public.quote_items WHERE quote_id = q.id;
    DELETE FROM public.quote_areas WHERE quote_id = q.id;
    v_result := 'updated';
  END IF;

  FOR grp IN
    SELECT min(btrim(area)) AS area, unit_size, count(*)::numeric AS qty, round(sum(pipe_m), 2) AS pipe_m
    FROM public.first_fit_points
    WHERE project_house_id = p_house AND company_id = p_co
    GROUP BY lower(btrim(area)), unit_size
    ORDER BY min(taken_at), min(btrim(area)), unit_size
  LOOP
    SELECT id INTO v_area FROM public.quote_areas WHERE quote_id = q.id AND name = grp.area;
    IF v_area IS NULL THEN
      INSERT INTO public.quote_areas (quote_id, name, sort_order)
      VALUES (q.id, grp.area, v_sort)
      RETURNING id INTO v_area;
    END IF;
    SELECT * INTO prod FROM public._ar40h_unit(grp.unit_size);
    IF NOT FOUND OR prod.product_id IS NULL THEN
      v_needed := true;
      v_pid := NULL;
      v_price := 0;
      v_code := NULL;
      v_name := 'Samsung AR40H ' || grp.unit_size || ' wall unit (model needed)';
    ELSE
      v_needed := coalesce(prod.unit_price, 0) <= 0;
      v_pid := prod.product_id;
      v_price := CASE WHEN v_needed THEN 0 ELSE prod.unit_price END;
      v_code := prod.item_number;
      v_name := CASE
        WHEN v_needed THEN coalesce(prod.item_name, 'Samsung AR40H ' || grp.unit_size || ' wall unit') || ' (price needed)'
        ELSE prod.item_name
      END;
    END IF;
    INSERT INTO public.quote_items (
      quote_id, area_id, item_name, item_number, description, quantity, unit_price, total_price,
      product_id, source, sort_order, unit_type, supplier, metadata
    ) VALUES (
      q.id, v_area, v_name, v_code,
      CASE WHEN prod.product_id IS NULL THEN 'Model needed. Default family is the Samsung AR40H wall unit.' ELSE NULL END,
      grp.qty, v_price, round(grp.qty * v_price, 2),
      v_pid, 'first_fit', v_sort, 'each', 'Samsung',
      jsonb_build_object('first_fit', true, 'unit_size', grp.unit_size, 'quote_category', 'units', 'model_needed', prod.product_id IS NULL, 'price_needed', v_needed)
    );
    v_sub := v_sub + round(grp.qty * v_price, 2);
    v_sort := v_sort + 1;
    INSERT INTO public.quote_items (
      quote_id, area_id, item_name, description, quantity, unit_price, total_price,
      source, sort_order, unit_type, metadata
    ) VALUES (
      q.id, v_area,
      'Piping — ' || grp.area || ' ' || grp.unit_size || ' (price needed)',
      'Per-metre price is not set yet. This line stays R0 until it is priced.',
      grp.pipe_m, 0, 0,
      'first_fit', v_sort, 'm',
      jsonb_build_object('first_fit', true, 'unit_size', grp.unit_size, 'quote_category', 'materials', 'price_needed', true, 'qty_unit', 'metre')
    );
    v_sort := v_sort + 1;
  END LOOP;

  v_rate := COALESCE(q.vat_rate, 0.15);
  v_disc := CASE WHEN cfg.discount_percent > 0 THEN v_sub * (cfg.discount_percent / 100.0) ELSE 0 END;
  v_vat := round((v_sub - v_disc) * v_rate, 2);
  v_total := round((v_sub - v_disc) * (1 + v_rate), 2);
  UPDATE public.quotes
  SET subtotal = v_sub, vat_amount = v_vat, total = v_total, first_fit_edited = false, status = 'draft', sent_at = NULL
  WHERE id = q.id;
  RETURN jsonb_build_object('result', v_result, 'id', q.id, 'quote_number', q.quote_number, 'total', v_total, 'discount_percent', cfg.discount_percent);
END $$;
REVOKE ALL ON FUNCTION public._write_first_fit_quote(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sync_issue_dates(p_house uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.project_houses%ROWTYPE;
  pr public.projects%ROWTYPE;
  cfg record;
  v_done date;
  v_issued date;
  v_deposit date;
  v_balance date;
  v_est boolean;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  IF h.id IS NULL OR NOT h.is_live OR h.first_fit_complete_at IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO pr FROM public.projects WHERE id = h.project_id;
  SELECT * INTO cfg FROM public._issue_settings(pr.customer_id, h.company_id);
  v_done := (h.first_fit_complete_at AT TIME ZONE 'Africa/Johannesburg')::date;
  v_deposit := public.snap_on_or_after(v_done + cfg.deposit_days, cfg.issue_snap_day);
  SELECT COALESCE((i.sent_at AT TIME ZONE 'Africa/Johannesburg')::date, i.issue_date)
    INTO v_issued
  FROM public.invoices i
  WHERE i.project_house_id = p_house
    AND i.issue_stage = 'deposit'
    AND coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled')
    AND i.archived_at IS NULL
  ORDER BY i.created_at
  LIMIT 1;
  v_est := v_issued IS NULL;
  v_balance := public.snap_on_or_after(COALESCE(v_issued, v_deposit) + cfg.balance_days, cfg.issue_snap_day);
  UPDATE public.project_houses
  SET deposit_due_on = v_deposit, balance_due_on = v_balance, balance_estimated = v_est
  WHERE id = p_house;
END $$;
REVOKE ALL ON FUNCTION public._sync_issue_dates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_house_issue_drafts(p_house uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.project_houses%ROWTYPE;
  q public.quotes%ROWTYPE;
  cfg record;
  v_today date := public._issue_today();
  v_agent uuid;
  v_dep_id uuid;
  v_bal_id uuid;
  v_dep numeric;
  v_bal numeric;
  v_others numeric;
  v_billed numeric;
  v_rate numeric;
  v_sub numeric;
  v_tax numeric;
  v_issued boolean := false;
  v_number text;
  cust record;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  IF h.id IS NULL THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF public._first_fit_staff() THEN
    IF h.company_id IS DISTINCT FROM public.caller_company_id() THEN
      RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
    END IF;
  ELSIF h.company_id IS DISTINCT FROM public._walda_co() THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF NOT h.is_live THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'not live');
  END IF;
  PERFORM public._sync_issue_dates(p_house);
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  SELECT * INTO q
  FROM public.quotes
  WHERE project_house_id = p_house AND origin = 'first_fit' AND archived_at IS NULL
  ORDER BY created_at LIMIT 1;
  IF q.id IS NULL THEN
    RETURN jsonb_build_object('result', 'skipped', 'reason', 'no quote');
  END IF;
  SELECT * INTO cfg FROM public._issue_settings(q.customer_id, h.company_id);
  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  SELECT cm.user_id INTO v_agent
  FROM public.company_members cm
  WHERE cm.company_id = h.company_id AND cm.role = 'admin'
  ORDER BY cm.created_at LIMIT 1;
  IF v_agent IS NULL THEN
    v_agent := COALESCE(q.sales_engineer_id, auth.uid());
  END IF;

  SELECT COALESCE(sum(i.grand_total), 0) INTO v_others
  FROM public.invoices i
  WHERE i.project_house_id = p_house
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
    AND i.archived_at IS NULL
    AND i.issue_stage IS NULL;
  v_dep := round(LEAST(round(COALESCE(q.total, 0) * 0.5, 2), GREATEST(round(COALESCE(q.total, 0) - v_others, 2), 0)), 2);

  SELECT i.id, (coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled') OR i.sent_at IS NOT NULL)
    INTO v_dep_id, v_issued
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'deposit'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;

  PERFORM set_config('app.first_fit_write', '1', true);
  IF v_dep_id IS NULL
     AND h.deposit_due_on IS NOT NULL
     AND v_today >= (h.deposit_due_on - cfg.prepare_days)
     AND v_dep > 0 THEN
    v_rate := COALESCE(q.vat_rate, 0.15);
    IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
    v_tax := round(v_dep * v_rate / (1 + v_rate), 2);
    v_sub := v_dep - v_tax;
    v_number := public.generate_invoice_number();
    INSERT INTO public.invoices (
      quote_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total, issue_date, status, line_items,
      company_id, project_house_id, notes, issue_stage, prep_edited
    ) VALUES (
      q.id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), cust.phone, cust.email, cust.address,
      v_number, v_sub, CASE WHEN v_rate <= 1 THEN v_rate * 100 ELSE v_rate END, v_tax, v_dep, h.deposit_due_on, 'draft',
      jsonb_build_array(jsonb_build_object(
        'description', 'Deposit 50% — house ' || h.house_no || ' — ' || COALESCE(q.quote_number, 'quote'),
        'quantity', 1, 'rate', v_sub, 'amount', v_sub
      )),
      h.company_id, p_house,
      'First fit deposit (50%) for house ' || h.house_no || '. Built from draft quote ' || COALESCE(q.quote_number, '') || ' — review before issuing. Nothing is sent automatically.',
      'deposit', false
    ) RETURNING id INTO v_dep_id;
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
    VALUES (v_dep_id, 'Deposit 50% — house ' || h.house_no, 1, v_sub, v_sub);
  ELSIF v_dep_id IS NOT NULL AND NOT v_issued THEN
    UPDATE public.invoices i
    SET grand_total = v_dep,
        tax_amount = round(v_dep * (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END) / (1 + (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END)), 2),
        subtotal = v_dep - round(v_dep * (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END) / (1 + (CASE WHEN COALESCE(q.vat_rate, 0.15) > 1 THEN COALESCE(q.vat_rate, 0.15) / 100 ELSE COALESCE(q.vat_rate, 0.15) END)), 2),
        issue_date = h.deposit_due_on,
        review_flag = CASE WHEN i.review_flag = 'First fit complete was undone — review before sending' THEN NULL ELSE i.review_flag END,
        notes = 'First fit deposit (50%) for house ' || h.house_no || '. Built from draft quote ' || COALESCE(q.quote_number, '') || ' — review before issuing. Nothing is sent automatically.'
    WHERE i.id = v_dep_id AND i.status = 'draft' AND i.prep_edited IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);
  END IF;

  SELECT (coalesce(i.status, '') NOT IN ('draft', 'void', 'cancelled') OR i.sent_at IS NOT NULL)
    INTO v_issued
  FROM public.invoices i WHERE i.id = v_dep_id;
  v_issued := COALESCE(v_issued, false);

  IF v_issued THEN
    PERFORM public._sync_issue_dates(p_house);
    SELECT * INTO h FROM public.project_houses WHERE id = p_house;
    SELECT COALESCE(sum(i.grand_total), 0) INTO v_billed
    FROM public.invoices i
    WHERE i.project_house_id = p_house
      AND coalesce(i.status, '') NOT IN ('void', 'cancelled')
      AND i.archived_at IS NULL
      AND coalesce(i.issue_stage, '') IS DISTINCT FROM 'balance';
    v_bal := round(COALESCE(q.total, 0) - v_billed, 2);
    SELECT i.id INTO v_bal_id
    FROM public.invoices i
    WHERE i.project_house_id = p_house AND i.issue_stage = 'balance'
      AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
    ORDER BY i.created_at LIMIT 1;
    IF v_bal_id IS NULL
       AND h.balance_due_on IS NOT NULL
       AND NOT h.balance_estimated
       AND v_today >= (h.balance_due_on - cfg.prepare_days)
       AND v_bal > 0 THEN
      v_rate := COALESCE(q.vat_rate, 0.15);
      IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
      v_tax := round(v_bal * v_rate / (1 + v_rate), 2);
      v_sub := v_bal - v_tax;
      v_number := public.generate_invoice_number();
      INSERT INTO public.invoices (
        quote_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
        invoice_number, subtotal, tax_rate, tax_amount, grand_total, issue_date, status, line_items,
        company_id, project_house_id, notes, issue_stage, prep_edited, sibling_invoice_id
      ) VALUES (
        q.id, v_agent, q.customer_id, COALESCE(cust.name, q.customer_name, ''), cust.phone, cust.email, cust.address,
        v_number, v_sub, CASE WHEN v_rate <= 1 THEN v_rate * 100 ELSE v_rate END, v_tax, v_bal, h.balance_due_on, 'draft',
        jsonb_build_array(jsonb_build_object(
          'description', 'Final balance — house ' || h.house_no || ' — ' || COALESCE(q.quote_number, 'quote'),
          'quantity', 1, 'rate', v_sub, 'amount', v_sub
        )),
        h.company_id, p_house,
        'First fit balance for house ' || h.house_no || '. Quote ' || COALESCE(q.quote_number, '') || ' less what is already invoiced on this house. Review before issuing. Nothing is sent automatically.',
        'balance', false, v_dep_id
      ) RETURNING id INTO v_bal_id;
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_bal_id, 'Final balance — house ' || h.house_no, 1, v_sub, v_sub);
    ELSIF v_bal_id IS NOT NULL AND v_bal > 0 THEN
      v_rate := COALESCE(q.vat_rate, 0.15);
      IF v_rate > 1 THEN v_rate := v_rate / 100; END IF;
      v_tax := round(v_bal * v_rate / (1 + v_rate), 2);
      v_sub := v_bal - v_tax;
      UPDATE public.invoices i
      SET grand_total = v_bal, tax_amount = v_tax, subtotal = v_sub, issue_date = h.balance_due_on,
          sibling_invoice_id = COALESCE(i.sibling_invoice_id, v_dep_id),
          review_flag = CASE WHEN i.review_flag = 'First fit complete was undone — review before sending' THEN NULL ELSE i.review_flag END
      WHERE i.id = v_bal_id AND i.status = 'draft' AND i.prep_edited IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);
    END IF;
  END IF;

  RETURN jsonb_build_object('result', 'refreshed', 'deposit_id', v_dep_id, 'balance_id', v_bal_id, 'deposit_due_on', h.deposit_due_on, 'balance_due_on', h.balance_due_on, 'balance_estimated', h.balance_estimated);
END $$;
REVOKE ALL ON FUNCTION public.refresh_house_issue_drafts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_house_issue_drafts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._assert_first_fit_ready(p_house uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.first_fit_points WHERE project_house_id = p_house) THEN
    RAISE EXCEPTION 'Add at least one point with an area, a unit size and pipe metres' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(u.area, ', ' ORDER BY u.sort_order, u.area) INTO v_missing
  FROM public.project_house_units u
  WHERE u.project_house_id = p_house
    AND NOT EXISTS (
      SELECT 1 FROM public.first_fit_points p
      WHERE p.project_house_id = u.project_house_id
        AND lower(btrim(p.area)) = lower(btrim(u.area))
    );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '% still needs a point', v_missing USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_first_fit_ready(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_first_fit_complete(p_house uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  h public.project_houses%ROWTYPE;
  v_hash text;
  v_quote jsonb;
  v_drafts jsonb;
  v_before jsonb;
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO h FROM public.project_houses WHERE id = p_house AND company_id = co FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_first_fit_ready(p_house);
  v_hash := public._points_hash(p_house);
  v_before := jsonb_build_object('is_live', h.is_live, 'first_fit_complete_at', h.first_fit_complete_at);
  IF h.is_live AND h.first_fit_hash IS NOT DISTINCT FROM v_hash THEN
    v_drafts := public.refresh_house_issue_drafts(p_house);
    PERFORM public._bot_audit(co, 'first_fit_complete_skipped', 'project_houses', p_house, v_before, to_jsonb(h));
    RETURN jsonb_build_object('result', 'skipped', 'house_id', p_house, 'is_live', true, 'drafts', v_drafts);
  END IF;
  UPDATE public.project_houses
  SET is_live = true,
      first_fit_complete_at = COALESCE(first_fit_complete_at, now()),
      first_fit_complete_by = COALESCE(first_fit_complete_by, auth.uid()),
      first_fit_hash = v_hash
  WHERE id = p_house;
  IF NOT h.is_live THEN
    UPDATE public.project_houses
    SET first_fit_complete_at = now(), first_fit_complete_by = auth.uid()
    WHERE id = p_house;
  END IF;
  v_quote := public._write_first_fit_quote(p_house, co);
  v_drafts := public.refresh_house_issue_drafts(p_house);
  PERFORM public._bot_audit(co, 'first_fit_complete', 'project_houses', p_house, v_before, jsonb_build_object('is_live', true, 'quote', v_quote));
  RETURN jsonb_build_object('result', 'complete', 'house_id', p_house, 'is_live', true, 'quote', v_quote, 'drafts', v_drafts);
END $$;
REVOKE ALL ON FUNCTION public.set_first_fit_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_first_fit_complete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.undo_first_fit_complete(p_house uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  h public.project_houses%ROWTYPE;
  v_before jsonb;
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO h FROM public.project_houses WHERE id = p_house AND company_id = co FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  v_before := to_jsonb(h);
  UPDATE public.project_houses
  SET is_live = false,
      first_fit_undone_at = now(),
      first_fit_undone_by = auth.uid(),
      deposit_due_on = NULL,
      balance_due_on = NULL,
      balance_estimated = false
  WHERE id = p_house;
  UPDATE public.quotes
  SET review_flag = 'First fit complete was undone — review before sending'
  WHERE project_house_id = p_house AND origin = 'first_fit' AND archived_at IS NULL AND status = 'draft';
  UPDATE public.invoices
  SET review_flag = 'First fit complete was undone — review before sending'
  WHERE project_house_id = p_house
    AND issue_stage IS NOT NULL
    AND status = 'draft'
    AND archived_at IS NULL;
  PERFORM public._bot_audit(co, 'first_fit_undone', 'project_houses', p_house, v_before, jsonb_build_object('is_live', false, 'undone_by', auth.uid()));
  RETURN jsonb_build_object('result', 'undone', 'house_id', p_house, 'is_live', false);
END $$;
REVOKE ALL ON FUNCTION public.undo_first_fit_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_first_fit_complete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_house_unit_list(p_house uuid, p_units jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  h public.project_houses%ROWTYPE;
  el jsonb;
  v_area text;
  v_size text;
  v_n int := 0;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF NOT public._first_fit_office() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO h FROM public.project_houses WHERE id = p_house AND company_id = co FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  IF p_units IS NULL OR jsonb_typeof(p_units) <> 'array' THEN
    RAISE EXCEPTION 'Unit list is required' USING ERRCODE = '22023';
  END IF;
  FOR el IN SELECT value FROM jsonb_array_elements(p_units) LOOP
    v_area := nullif(btrim(el->>'area'), '');
    v_size := public._normalize_unit_size(el->>'unit_size');
    IF v_area IS NULL THEN
      RAISE EXCEPTION 'Area is required' USING ERRCODE = '22023';
    END IF;
    IF v_size IS NULL THEN
      RAISE EXCEPTION 'Unit size must be 9K, 12K, 18K or 24K' USING ERRCODE = '22023';
    END IF;
    IF lower(v_area) = ANY (v_seen) THEN
      RAISE EXCEPTION 'Each area is listed once' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, lower(v_area));
  END LOOP;
  DELETE FROM public.project_house_units WHERE project_house_id = p_house;
  FOR el IN SELECT value FROM jsonb_array_elements(p_units) LOOP
    v_area := btrim(el->>'area');
    v_size := public._normalize_unit_size(el->>'unit_size');
    INSERT INTO public.project_house_units (company_id, project_house_id, area, unit_size, sort_order)
    VALUES (co, p_house, v_area, v_size, v_n);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('result', 'saved', 'house_id', p_house, 'areas', v_n);
END $$;
REVOKE ALL ON FUNCTION public.save_house_unit_list(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_house_unit_list(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Read models: house page, project cards, WALDA 8am digest.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._house_fit_row(p_house uuid, p_office boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h public.project_houses%ROWTYPE;
  pr public.projects%ROWTYPE;
  cfg record;
  q record;
  v_points int;
  v_areas int;
  v_pipe numeric;
  v_by text;
  v_undo text;
  v_dep jsonb;
  v_bal jsonb;
BEGIN
  SELECT * INTO h FROM public.project_houses WHERE id = p_house;
  SELECT * INTO pr FROM public.projects WHERE id = h.project_id;
  SELECT * INTO cfg FROM public._issue_settings(pr.customer_id, h.company_id);
  SELECT count(*) INTO v_points FROM public.first_fit_points WHERE project_house_id = p_house;
  SELECT count(*) INTO v_areas FROM public.project_house_units WHERE project_house_id = p_house;
  SELECT COALESCE(round(sum(pipe_m), 2), 0) INTO v_pipe FROM public.first_fit_points WHERE project_house_id = p_house;
  SELECT full_name INTO v_by FROM public.profiles WHERE id = h.first_fit_complete_by;
  SELECT full_name INTO v_undo FROM public.profiles WHERE id = h.first_fit_undone_by;
  SELECT q.id, q.quote_number, q.review_flag, q.total, q.status INTO q
  FROM public.quotes q
  WHERE q.project_house_id = p_house AND q.origin = 'first_fit' AND q.archived_at IS NULL
  ORDER BY q.created_at LIMIT 1;
  SELECT jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'status', i.status, 'amount', CASE WHEN p_office THEN i.grand_total ELSE NULL END, 'flag', i.review_flag
  ) INTO v_dep
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'deposit'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;
  SELECT jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'status', i.status, 'amount', CASE WHEN p_office THEN i.grand_total ELSE NULL END, 'flag', i.review_flag
  ) INTO v_bal
  FROM public.invoices i
  WHERE i.project_house_id = p_house AND i.issue_stage = 'balance'
    AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
  ORDER BY i.created_at LIMIT 1;
  RETURN jsonb_build_object(
    'house_id', h.id,
    'company_id', h.company_id,
    'house_no', h.house_no,
    'project_id', h.project_id,
    'project_name', pr.name,
    'live', h.is_live,
    'complete_at', h.first_fit_complete_at,
    'complete_by', v_by,
    'undone_at', CASE WHEN h.is_live THEN NULL ELSE h.first_fit_undone_at END,
    'undone_by', CASE WHEN h.is_live THEN NULL ELSE v_undo END,
    'points', v_points,
    'areas', v_areas,
    'pipe_m', v_pipe,
    'deposit_on', h.deposit_due_on,
    'deposit_state', public.issue_schedule_state(h.deposit_due_on, public._issue_today(), cfg.prepare_days, false),
    'balance_on', h.balance_due_on,
    'balance_state', public.issue_schedule_state(h.balance_due_on, public._issue_today(), cfg.prepare_days, h.balance_estimated),
    'balance_estimated', h.balance_estimated,
    'deposit', v_dep,
    'balance', v_bal,
    'quote', CASE WHEN q.id IS NULL THEN NULL
      WHEN p_office THEN jsonb_build_object('id', q.id, 'number', q.quote_number, 'flag', q.review_flag, 'total', q.total, 'status', q.status)
      ELSE jsonb_build_object('ready', true, 'flag', q.review_flag) END,
    'default_unit', 'Samsung AR40H wall unit'
  );
END $$;
REVOKE ALL ON FUNCTION public._house_fit_row(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.house_first_fit_detail(p_house uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  h public.project_houses%ROWTYPE;
  v_office boolean := public._first_fit_office();
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO h FROM public.project_houses WHERE id = p_house AND company_id = co;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'House not found' USING ERRCODE = '42501';
  END IF;
  RETURN public._house_fit_row(p_house, v_office) || jsonb_build_object(
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'area', u.area, 'unit_size', u.unit_size) ORDER BY u.sort_order, u.area)
      FROM public.project_house_units u WHERE u.project_house_id = p_house
    ), '[]'::jsonb),
    'point_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'area', p.area, 'unit_size', p.unit_size, 'pipe_m', p.pipe_m,
        'storage_path', p.storage_path, 'caption', p.caption, 'taken_at', p.taken_at, 'source', p.source
      ) ORDER BY p.taken_at)
      FROM public.first_fit_points p WHERE p.project_house_id = p_house
    ), '[]'::jsonb),
    'photos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', hp.id, 'storage_path', hp.storage_path, 'caption', hp.caption, 'photo_type', hp.photo_type, 'taken_at', hp.taken_at
      ) ORDER BY hp.taken_at DESC)
      FROM public.house_photos hp WHERE hp.project_house_id = p_house
    ), '[]'::jsonb),
    'can_edit_list', v_office
  );
END $$;
REVOKE ALL ON FUNCTION public.house_first_fit_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.house_first_fit_detail(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.house_first_fit_board(p_project uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  v_rows jsonb;
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project AND p.company_id = co) THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(public._house_fit_row(h.id, public._first_fit_office()) ORDER BY h.house_no), '[]'::jsonb)
    INTO v_rows
  FROM public.project_houses h
  WHERE h.project_id = p_project AND h.company_id = co;
  RETURN jsonb_build_object('houses', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.house_first_fit_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.house_first_fit_board(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_first_fit_houses(p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public.caller_company_id();
  v_q text := nullif(btrim(p_query), '');
  v_rows jsonb;
BEGIN
  IF NOT public._first_fit_staff() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'house_no'), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'house_id', h.id, 'house_no', h.house_no, 'project_name', p.name, 'project_id', p.id, 'live', h.is_live
    ) AS x
    FROM public.project_houses h
    JOIN public.projects p ON p.id = h.project_id
    WHERE h.company_id = co
      AND (v_q IS NULL OR h.house_no ILIKE '%' || v_q || '%' OR p.name ILIKE '%' || v_q || '%')
    ORDER BY p.name, length(h.house_no), h.house_no
    LIMIT 40
  ) s;
  RETURN jsonb_build_object('houses', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.search_first_fit_houses(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_first_fit_houses(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.walda_first_fit_issue_digest(p_on date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public._walda_co();
  v_today date;
  r record;
  v_rows jsonb := '[]'::jsonb;
  cfg record;
  v_state text;
  v_amount numeric;
BEGIN
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NOT NULL THEN
    PERFORM set_config('app.backfill', '1', true);
    PERFORM set_config('app.today', p_on::text, true);
  END IF;
  v_today := public._issue_today();
  FOR r IN
    SELECT h.id
    FROM public.project_houses h
    WHERE h.company_id = co AND h.is_live
  LOOP
    PERFORM public.refresh_house_issue_drafts(r.id);
  END LOOP;
  FOR r IN
    SELECT h.*, p.name AS project_name, p.customer_id
    FROM public.project_houses h
    JOIN public.projects p ON p.id = h.project_id
    WHERE h.company_id = co AND (h.deposit_due_on IS NOT NULL OR h.balance_due_on IS NOT NULL)
  LOOP
    SELECT * INTO cfg FROM public._issue_settings(r.customer_id, co);
    v_state := public.issue_schedule_state(r.deposit_due_on, v_today, cfg.prepare_days, false);
    IF v_state IN ('due_soon', 'due_today', 'overdue') THEN
      SELECT i.grand_total INTO v_amount
      FROM public.invoices i
      WHERE i.project_house_id = r.id AND i.issue_stage = 'deposit'
        AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
      ORDER BY i.created_at LIMIT 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'kind', 'deposit', 'state', v_state, 'due_on', r.deposit_due_on,
        'house_id', r.id, 'house_no', r.house_no, 'project_id', r.project_id, 'project_name', r.project_name,
        'amount', v_amount, 'estimated', false,
        'link', '/admin/projects/' || r.project_id || '?house=' || r.id
      ));
    END IF;
    v_state := public.issue_schedule_state(r.balance_due_on, v_today, cfg.prepare_days, r.balance_estimated);
    IF v_state IN ('due_soon', 'due_today', 'overdue') THEN
      SELECT i.grand_total INTO v_amount
      FROM public.invoices i
      WHERE i.project_house_id = r.id AND i.issue_stage = 'balance'
        AND coalesce(i.status, '') NOT IN ('void', 'cancelled') AND i.archived_at IS NULL
      ORDER BY i.created_at LIMIT 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'kind', 'balance', 'state', v_state, 'due_on', r.balance_due_on,
        'house_id', r.id, 'house_no', r.house_no, 'project_id', r.project_id, 'project_name', r.project_name,
        'amount', v_amount, 'estimated', false,
        'link', '/admin/projects/' || r.project_id || '?house=' || r.id
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('on', v_today, 'rows', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.walda_first_fit_issue_digest(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_first_fit_issue_digest(date) TO authenticated;

CREATE OR REPLACE VIEW public.first_fit_issue_schedule
WITH (security_invoker = true) AS
SELECT
  h.id AS house_id,
  h.company_id,
  h.project_id,
  p.name AS project_name,
  h.house_no,
  h.is_live,
  h.deposit_due_on,
  h.balance_due_on,
  h.balance_estimated,
  public.issue_schedule_state(h.deposit_due_on, public._issue_today(), COALESCE(s.prepare_days, 7), false) AS deposit_state,
  public.issue_schedule_state(h.balance_due_on, public._issue_today(), COALESCE(s.prepare_days, 7), h.balance_estimated) AS balance_state
FROM public.project_houses h
JOIN public.projects p ON p.id = h.project_id
LEFT JOIN public.client_issue_settings s ON s.customer_id = p.customer_id AND s.company_id = h.company_id
WHERE h.is_live OR h.deposit_due_on IS NOT NULL;

GRANT SELECT ON public.first_fit_issue_schedule TO authenticated;

-- Keep office edits. Our own writes set app.first_fit_write and are not marked edited.
CREATE OR REPLACE FUNCTION public.trg_first_fit_quote_edited()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  qid uuid := COALESCE(NEW.quote_id, OLD.quote_id);
BEGIN
  IF current_setting('app.first_fit_write', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  UPDATE public.quotes
  SET first_fit_edited = true
  WHERE id = qid AND origin = 'first_fit' AND first_fit_edited IS NOT TRUE;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_first_fit_quote_edited ON public.quote_items;
CREATE TRIGGER trg_first_fit_quote_edited
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_first_fit_quote_edited();

CREATE OR REPLACE FUNCTION public.trg_issue_prep_edited()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('app.first_fit_write', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.issue_stage IS NOT NULL AND (
    NEW.grand_total IS DISTINCT FROM OLD.grand_total
    OR NEW.line_items IS DISTINCT FROM OLD.line_items
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.notes IS DISTINCT FROM OLD.notes
  ) THEN
    NEW.prep_edited := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_issue_prep_edited ON public.invoices;
CREATE TRIGGER trg_issue_prep_edited
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_issue_prep_edited();

-- A sent deposit invoice moves the balance date onto the real issue date. The invoice row is not rewritten.
CREATE OR REPLACE FUNCTION public.trg_first_fit_deposit_issued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.issue_stage IS DISTINCT FROM 'deposit' OR NEW.project_house_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF coalesce(OLD.status, 'draft') = 'draft'
     AND coalesce(NEW.status, '') NOT IN ('draft', 'void', 'cancelled') THEN
    PERFORM public._sync_issue_dates(NEW.project_house_id);
  ELSIF OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL THEN
    PERFORM public._sync_issue_dates(NEW.project_house_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_first_fit_deposit_issued ON public.invoices;
CREATE TRIGGER trg_first_fit_deposit_issued
  AFTER UPDATE OF status, sent_at ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_first_fit_deposit_issued();

-- RLS. Writes go through the functions above.
ALTER TABLE public.house_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_house_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.first_fit_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_issue_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.house_photos FROM anon, authenticated;
REVOKE ALL ON public.project_house_units FROM anon, authenticated;
REVOKE ALL ON public.first_fit_points FROM anon, authenticated;
REVOKE ALL ON public.client_issue_settings FROM anon, authenticated;
GRANT SELECT ON public.house_photos TO authenticated;
GRANT SELECT ON public.project_house_units TO authenticated;
GRANT SELECT ON public.first_fit_points TO authenticated;
GRANT SELECT ON public.client_issue_settings TO authenticated;

DROP POLICY IF EXISTS house_photos_read ON public.house_photos;
CREATE POLICY house_photos_read ON public.house_photos
  FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id() AND public._first_fit_staff());
DROP POLICY IF EXISTS project_house_units_read ON public.project_house_units;
CREATE POLICY project_house_units_read ON public.project_house_units
  FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id() AND public._first_fit_staff());
DROP POLICY IF EXISTS first_fit_points_read ON public.first_fit_points;
CREATE POLICY first_fit_points_read ON public.first_fit_points
  FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id() AND public._first_fit_staff());
DROP POLICY IF EXISTS client_issue_settings_read ON public.client_issue_settings;
CREATE POLICY client_issue_settings_read ON public.client_issue_settings
  FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id() AND public._first_fit_office());

-- Private house-photos bucket. Old job-photos policies learn the company prefix.
DO $pol$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public)
  SELECT 'house-photos', 'house-photos', false
  WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'house-photos');
  UPDATE storage.buckets SET public = false WHERE id = 'house-photos';

  EXECUTE 'CREATE OR REPLACE FUNCTION public.house_photo_ok(_name text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $f$
    SELECT public._first_fit_staff()
      AND public.caller_company_id() IS NOT NULL
      AND split_part(_name, ''/'', 1) = public.caller_company_id()::text
      AND split_part(_name, ''/'', 3) ~* ''^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$''
      AND EXISTS (
        SELECT 1 FROM public.project_houses h
        WHERE h.id = split_part(_name, ''/'', 3)::uuid
          AND h.company_id = public.caller_company_id()
          AND h.project_id::text = split_part(_name, ''/'', 2)
      )
    $f$';
  EXECUTE 'REVOKE ALL ON FUNCTION public.house_photo_ok(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.house_photo_ok(text) TO authenticated';

  EXECUTE 'DROP POLICY IF EXISTS house_photos_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS house_photos_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS house_photos_delete ON storage.objects';
  EXECUTE 'CREATE POLICY house_photos_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''house-photos'' AND public.house_photo_ok(name))';
  EXECUTE 'CREATE POLICY house_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''house-photos'' AND public.house_photo_ok(name))';
  EXECUTE 'CREATE POLICY house_photos_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''house-photos'' AND public.house_photo_ok(name))';

  EXECUTE 'DROP POLICY IF EXISTS "jp_insert" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "jp_delete" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "jp_update" ON storage.objects';
  EXECUTE 'CREATE POLICY "jp_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)) AND public.job_photo_path_company_ok(name))';
  EXECUTE 'CREATE POLICY "jp_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)) AND public.job_photo_path_company_ok(name))';
  EXECUTE 'CREATE POLICY "jp_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)) AND public.job_photo_path_company_ok(name)) WITH CHECK (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)) AND public.job_photo_path_company_ok(name))';
END $pol$;
