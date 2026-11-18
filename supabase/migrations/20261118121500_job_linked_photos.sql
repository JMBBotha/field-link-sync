-- Linked photos on a job (Johan, 18 Nov 2026: "make sure that all pictures in future are linked").
-- NOT APPLIED by this pull request. Do not run this against the live database from the PR.
--
-- Read only. Photos stay where they were saved (quote-photos, job-photos, site-surveys, house-photos).
-- Nothing is copied, and no existing photo, quote, invoice, lead, or job row is updated.
-- enforce_company_writable is not touched.
--
-- What this grants, same company only:
--   * An assigned technician (assignments.profile_id, status not declined / cancelled / rejected)
--     may SELECT the quote attachments, lead photos, and site-survey pictures linked to that job,
--     and may create a signed URL for those objects.
--   * A salesperson may do the same only for a job they booked or are assigned to
--     (created the job, handed it over, own the quote or the lead, or own the customer).
--   * Office staff (admin, dispatcher who is not a salesperson, platform staff) may do the same
--     for jobs in their own company.
-- A technician does not gain access to another job, another company, or write/delete on these photos.
-- photo_quote_ok and photo_lead_ok (upload and delete) are unchanged.
--
-- House photos (the customer's site on a project house) are included when that table exists.
-- The first-fit migration adds it; until then the function skips that source.

CREATE OR REPLACE FUNCTION public.linked_photo_path_ok(_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $fn$
  SELECT _path IS NOT NULL
    AND btrim(_path) <> ''
    AND _path !~ '\.\.'
    AND left(_path, 1) <> '/'
    AND position('://' IN _path) = 0
    AND position(E'\n' IN _path) = 0
$fn$;

-- Old job-photos path: {lead}/{file}. Newer path: {company}/{lead}/{file}.
CREATE OR REPLACE FUNCTION public.linked_photo_folder_lead(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $fn$
  SELECT CASE
    WHEN split_part(_name, '/', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
     AND split_part(_name, '/', 3) <> ''
      THEN split_part(_name, '/', 2)::uuid
    WHEN split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      THEN split_part(_name, '/', 1)::uuid
    ELSE NULL
  END
$fn$;

-- quote-photos path: {company}/{quote}/file or {company}/sections/{quote}/file.
CREATE OR REPLACE FUNCTION public.linked_quote_id_from_path(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO public
AS $fn$
  SELECT CASE
    WHEN split_part(_name, '/', 1) !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN NULL
    WHEN split_part(_name, '/', 2) = 'sections'
     AND split_part(_name, '/', 3) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      THEN split_part(_name, '/', 3)::uuid
    WHEN split_part(_name, '/', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
      THEN split_part(_name, '/', 2)::uuid
    ELSE NULL
  END
$fn$;

-- Who may see linked photos for one job. Mirrors src/lib/linkedPhotos.ts mayReadLinkedPhotos.
CREATE OR REPLACE FUNCTION public.caller_may_read_linked_job(p_job uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT auth.uid() IS NOT NULL
    AND p_job IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = p_job
        AND j.company_id = public.caller_company_id()
        AND (
          (
            public.is_field_tech_only(auth.uid())
            AND EXISTS (
              SELECT 1 FROM public.assignments a
              WHERE a.job_id = j.id
                AND a.profile_id = auth.uid()
                AND coalesce(a.status, '') NOT IN ('declined', 'cancelled', 'rejected')
            )
          )
          OR (
            NOT public.is_field_tech_only(auth.uid())
            AND public.is_sales_rep(auth.uid())
            AND (
              j.created_by = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.customers c
                WHERE c.id = j.customer_id
                  AND c.company_id = j.company_id
                  AND auth.uid() IN (c.assigned_rep_id, c.owner_rep_id)
              )
              OR EXISTS (
                SELECT 1 FROM public.assignments a
                WHERE a.job_id = j.id
                  AND (
                    a.assigned_by = auth.uid()
                    OR (
                      a.profile_id = auth.uid()
                      AND coalesce(a.status, '') NOT IN ('declined', 'cancelled', 'rejected')
                    )
                  )
              )
              OR EXISTS (
                SELECT 1 FROM public.job_schedules s
                WHERE s.job_id = j.id AND s.agent_id = auth.uid()
              )
              OR EXISTS (
                SELECT 1 FROM public.quotes q
                WHERE q.company_id = j.company_id
                  AND (
                    q.id = j.quote_id
                    OR q.id = j.variation_quote_id
                    OR (j.lead_id IS NOT NULL AND q.lead_id = j.lead_id)
                  )
                  AND auth.uid() IN (q.sales_engineer_id, q.owner_id, q.created_by)
              )
              OR EXISTS (
                SELECT 1 FROM public.leads l
                WHERE l.id = j.lead_id
                  AND l.company_id = j.company_id
                  AND l.deleted_at IS NULL
                  AND (
                    auth.uid() IN (l.assigned_agent_id, l.created_by)
                    OR EXISTS (
                      SELECT 1 FROM public.lead_assignment_log g
                      WHERE g.lead_id = l.id
                        AND g.company_id = l.company_id
                        AND g.assigned_by = auth.uid()
                    )
                  )
              )
            )
          )
          OR (
            NOT public.is_field_tech_only(auth.uid())
            AND NOT public.is_sales_rep(auth.uid())
            AND (
              public.has_role(auth.uid(), 'admin'::public.app_role)
              OR public.has_role(auth.uid(), 'dispatcher'::public.app_role)
              OR public.has_role(auth.uid(), 'platform_super_admin'::public.app_role)
              OR public.has_role(auth.uid(), 'platform_ops'::public.app_role)
            )
          )
        )
    )
$fn$;

-- Relationship only. Not granted to clients; the readable-job functions call it.
CREATE OR REPLACE FUNCTION public.job_links_quote(p_job uuid, p_quote uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT p_job IS NOT NULL AND p_quote IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.quotes q ON q.id = p_quote
     AND (q.company_id = j.company_id OR (q.company_id IS NULL AND (j.quote_id = q.id OR j.variation_quote_id = q.id)))
    WHERE j.id = p_job
      AND (
        j.quote_id = q.id
        OR j.variation_quote_id = q.id
        OR EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = j.invoice_id
            AND i.company_id = j.company_id
            AND i.quote_id = q.id
        )
      )
  )
$fn$;

CREATE OR REPLACE FUNCTION public.job_links_lead(p_job uuid, p_lead uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT p_job IS NOT NULL AND p_lead IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = p_job
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = p_lead AND l.company_id = j.company_id
      )
      AND (
        j.lead_id = p_lead
        OR EXISTS (
          SELECT 1 FROM public.quotes q
          WHERE q.lead_id = p_lead
            AND q.company_id = j.company_id
            AND public.job_links_quote(j.id, q.id)
        )
        OR EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = j.invoice_id
            AND i.company_id = j.company_id
            AND i.lead_id = p_lead
        )
      )
  )
$fn$;

CREATE OR REPLACE FUNCTION public.quote_linked_to_readable_job(p_quote uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.company_id = public.caller_company_id()
      AND public.caller_may_read_linked_job(j.id)
      AND public.job_links_quote(j.id, p_quote)
  )
$fn$;

CREATE OR REPLACE FUNCTION public.lead_linked_to_readable_job(p_lead uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.leads l
      ON l.id = p_lead
     AND l.company_id = j.company_id
     AND l.company_id = public.caller_company_id()
    WHERE public.caller_may_read_linked_job(j.id)
      AND public.job_links_lead(j.id, p_lead)
  )
$fn$;

CREATE OR REPLACE FUNCTION public.survey_linked_to_readable_job(p_survey uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.site_surveys s
    WHERE s.id = p_survey
      AND s.company_id = public.caller_company_id()
      AND s.archived_at IS NULL
      AND (
        (s.lead_id IS NOT NULL AND public.lead_linked_to_readable_job(s.lead_id))
        OR (s.quote_id IS NOT NULL AND public.quote_linked_to_readable_job(s.quote_id))
      )
  )
$fn$;

CREATE OR REPLACE FUNCTION public.linked_quote_photo_readable(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT public.caller_company_id() IS NOT NULL
    AND split_part(_name, '/', 1) = public.caller_company_id()::text
    AND public.linked_quote_id_from_path(_name) IS NOT NULL
    AND public.quote_linked_to_readable_job(public.linked_quote_id_from_path(_name))
$fn$;

CREATE OR REPLACE FUNCTION public.linked_lead_photo_readable(_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_lead uuid := public.linked_photo_folder_lead(_name);
  v_co text := public.caller_company_id()::text;
BEGIN
  IF v_lead IS NULL OR v_co IS NULL THEN RETURN false; END IF;
  IF split_part(_name, '/', 1) IS DISTINCT FROM v_co
     AND split_part(_name, '/', 1) IS DISTINCT FROM v_lead::text THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = v_lead AND l.company_id = public.caller_company_id()
  ) THEN
    RETURN false;
  END IF;
  RETURN public.lead_linked_to_readable_job(v_lead);
END
$fn$;

CREATE OR REPLACE FUNCTION public.linked_survey_photo_readable(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT public.caller_company_id() IS NOT NULL
    AND split_part(_name, '/', 1) = public.caller_company_id()::text
    AND split_part(_name, '/', 2) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    AND public.survey_linked_to_readable_job(split_part(_name, '/', 2)::uuid)
$fn$;

-- One list for the job page and the technician job view. Paths only, no prices.
CREATE OR REPLACE FUNCTION public.job_linked_photos(p_job uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_job public.jobs%ROWTYPE;
  v jsonb := '[]'::jsonb;
  v_house jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.caller_may_read_linked_job(p_job) THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job;
  IF NOT FOUND OR v_job.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'bucket', x.bucket,
    'storage_path', x.storage_path,
    'display_path', x.display_path,
    'caption', x.caption,
    'source', x.source,
    'ref', x.ref,
    'lead_id', x.lead_id,
    'created_at', x.created_at
  )), '[]'::jsonb)
  INTO v
  FROM (
    SELECT a.id::text AS id,
           'quote-photos'::text AS bucket,
           a.storage_path,
           a.storage_path AS display_path,
           NULLIF(btrim(coalesce(a.caption, a.filename, '')), '') AS caption,
           CASE WHEN q.id = v_job.quote_id OR q.id = v_job.variation_quote_id THEN 'quote' ELSE 'invoice' END AS source,
           CASE
             WHEN q.id = v_job.quote_id OR q.id = v_job.variation_quote_id THEN q.quote_number
             ELSE (
               SELECT i.invoice_number FROM public.invoices i
               WHERE i.id = v_job.invoice_id AND i.company_id = v_job.company_id AND i.quote_id = q.id
               LIMIT 1
             )
           END AS ref,
           NULL::uuid AS lead_id,
           a.created_at
    FROM public.quote_attachments a
    JOIN public.quotes q ON q.id = a.quote_id
    WHERE public.job_links_quote(v_job.id, q.id)
      AND public.linked_photo_path_ok(a.storage_path)

    UNION ALL

    SELECT ('vis:' || q.id::text || ':' || bits[1]) AS id,
           'quote-photos'::text,
           bits[1],
           bits[1],
           NULL::text,
           CASE WHEN q.id = v_job.quote_id OR q.id = v_job.variation_quote_id THEN 'quote' ELSE 'invoice' END,
           CASE
             WHEN q.id = v_job.quote_id OR q.id = v_job.variation_quote_id THEN q.quote_number
             ELSE (
               SELECT i.invoice_number FROM public.invoices i
               WHERE i.id = v_job.invoice_id AND i.company_id = v_job.company_id AND i.quote_id = q.id
               LIMIT 1
             )
           END,
           NULL::uuid,
           q.created_at
    FROM public.quotes q
    CROSS JOIN LATERAL regexp_matches(coalesce(q.visual_sections::text, ''), 'quote-photos:([^"[:space:]]+)', 'g') AS shot(bits)
    WHERE public.job_links_quote(v_job.id, q.id)
      AND public.linked_photo_path_ok(bits[1])

    UNION ALL

    SELECT p.id::text,
           'job-photos'::text,
           p.storage_path,
           CASE WHEN public.linked_photo_path_ok(p.annotated_path) THEN p.annotated_path ELSE p.storage_path END,
           NULLIF(btrim(coalesce(p.caption, '')), ''),
           'site_visit'::text,
           NULL::text,
           p.lead_id,
           p.created_at
    FROM public.job_photos p
    JOIN public.leads l ON l.id = p.lead_id AND l.company_id = v_job.company_id
    WHERE public.job_links_lead(v_job.id, l.id)
      AND public.linked_photo_path_ok(p.storage_path)

    UNION ALL

    SELECT ('ss:' || m.id::text),
           'site-surveys'::text,
           m.storage_path,
           CASE WHEN public.linked_photo_path_ok(m.annotated_path) THEN m.annotated_path ELSE m.storage_path END,
           NULLIF(btrim(coalesce(m.caption, '')), ''),
           'site_visit'::text,
           NULL::text,
           s.lead_id,
           coalesce(m.taken_at, m.created_at)
    FROM public.site_survey_media m
    JOIN public.site_surveys s ON s.id = m.survey_id AND s.company_id = v_job.company_id
    WHERE m.company_id = v_job.company_id
      AND m.kind <> 'audio'
      AND m.archived_at IS NULL
      AND s.archived_at IS NULL
      AND public.linked_photo_path_ok(m.storage_path)
      AND (
        (s.lead_id IS NOT NULL AND public.job_links_lead(v_job.id, s.lead_id))
        OR (s.quote_id IS NOT NULL AND public.job_links_quote(v_job.id, s.quote_id))
      )
  ) x;

  IF to_regclass('public.house_photos') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'quotes' AND column_name = 'project_house_id'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'project_house_id'
     )
  THEN
    EXECUTE $h$
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', hp.id::text,
        'bucket', 'house-photos',
        'storage_path', hp.storage_path,
        'display_path', hp.storage_path,
        'caption', NULLIF(btrim(coalesce(hp.caption, '')), ''),
        'source', 'site',
        'ref', NULL,
        'lead_id', NULL,
        'created_at', hp.created_at
      )), '[]'::jsonb)
      FROM public.house_photos hp
      WHERE hp.company_id = $1
        AND public.linked_photo_path_ok(hp.storage_path)
        AND hp.project_house_id IN (
          SELECT q.project_house_id
          FROM public.quotes q
          WHERE q.company_id = $1
            AND q.project_house_id IS NOT NULL
            AND public.job_links_quote($2, q.id)
          UNION
          SELECT i.project_house_id
          FROM public.invoices i
          WHERE i.company_id = $1
            AND i.project_house_id IS NOT NULL
            AND (
              i.id = $3
              OR (i.quote_id IS NOT NULL AND public.job_links_quote($2, i.quote_id))
            )
        )
    $h$ INTO v_house USING v_job.company_id, v_job.id, v_job.invoice_id;
    v := coalesce(v, '[]'::jsonb) || coalesce(v_house, '[]'::jsonb);
  END IF;

  RETURN coalesce(v, '[]'::jsonb);
END
$fn$;

REVOKE ALL ON FUNCTION public.linked_photo_path_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linked_photo_folder_lead(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.linked_quote_id_from_path(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.caller_may_read_linked_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_links_quote(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_links_lead(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_linked_to_readable_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_linked_to_readable_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.survey_linked_to_readable_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.linked_quote_photo_readable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.linked_lead_photo_readable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.linked_survey_photo_readable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_linked_photos(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.quote_linked_to_readable_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_linked_to_readable_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.survey_linked_to_readable_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.linked_quote_photo_readable(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.linked_lead_photo_readable(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.linked_survey_photo_readable(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_linked_photos(uuid) TO authenticated;

-- Extra SELECT only. Upload and delete policies stay as they are.
DROP POLICY IF EXISTS qa_linked_job_read ON public.quote_attachments;
CREATE POLICY qa_linked_job_read ON public.quote_attachments
  FOR SELECT TO authenticated
  USING (public.quote_linked_to_readable_job(quote_id));

DROP POLICY IF EXISTS jp_linked_job_read ON public.job_photos;
CREATE POLICY jp_linked_job_read ON public.job_photos
  FOR SELECT TO authenticated
  USING (public.lead_linked_to_readable_job(lead_id));

DROP POLICY IF EXISTS ss_linked_job_read ON public.site_surveys;
CREATE POLICY ss_linked_job_read ON public.site_surveys
  FOR SELECT TO authenticated
  USING (
    company_id = public.caller_company_id()
    AND archived_at IS NULL
    AND public.survey_linked_to_readable_job(id)
  );

DO $pol$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS quote_photos_linked_job_read ON storage.objects';
  EXECUTE 'CREATE POLICY quote_photos_linked_job_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''quote-photos'' AND public.linked_quote_photo_readable(name))';
  EXECUTE 'DROP POLICY IF EXISTS job_photos_linked_job_read ON storage.objects';
  EXECUTE 'CREATE POLICY job_photos_linked_job_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''job-photos'' AND public.linked_lead_photo_readable(name))';
  EXECUTE 'DROP POLICY IF EXISTS site_surveys_linked_job_read ON storage.objects';
  EXECUTE 'CREATE POLICY site_surveys_linked_job_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''site-surveys'' AND public.linked_survey_photo_readable(name))';
END
$pol$;
