-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Removes first-fit houses, house photos, and the issue-date columns.
-- Quote rows, invoice rows, invoice numbers, and payments stay.
-- Job photo files stay where they are. New uploads can use {lead}/{file} again.

DROP TRIGGER IF EXISTS trg_first_fit_deposit_issued ON public.invoices;
DROP TRIGGER IF EXISTS trg_issue_prep_edited ON public.invoices;
DROP TRIGGER IF EXISTS trg_first_fit_quote_edited ON public.quote_items;
DROP FUNCTION IF EXISTS public.trg_first_fit_deposit_issued();
DROP FUNCTION IF EXISTS public.trg_issue_prep_edited();
DROP FUNCTION IF EXISTS public.trg_first_fit_quote_edited();

DROP VIEW IF EXISTS public.first_fit_issue_schedule;

DROP FUNCTION IF EXISTS public.walda_first_fit_issue_digest(date);
DROP FUNCTION IF EXISTS public.search_first_fit_houses(text);
DROP FUNCTION IF EXISTS public.house_first_fit_board(uuid);
DROP FUNCTION IF EXISTS public.house_first_fit_detail(uuid);
DROP FUNCTION IF EXISTS public._house_fit_row(uuid, boolean);
DROP FUNCTION IF EXISTS public.save_house_unit_list(uuid, jsonb);
DROP FUNCTION IF EXISTS public.undo_first_fit_complete(uuid);
DROP FUNCTION IF EXISTS public.set_first_fit_complete(uuid);
DROP FUNCTION IF EXISTS public._assert_first_fit_ready(uuid);
DROP FUNCTION IF EXISTS public.refresh_house_issue_drafts(uuid);
DROP FUNCTION IF EXISTS public._sync_issue_dates(uuid);
DROP FUNCTION IF EXISTS public._write_first_fit_quote(uuid, uuid);
DROP FUNCTION IF EXISTS public._points_hash(uuid);
DROP FUNCTION IF EXISTS public._ar40h_unit(text);
DROP FUNCTION IF EXISTS public.record_house_photo(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.record_first_fit_point(uuid, uuid, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.walda_record_first_fit_point(uuid, uuid, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public._save_first_fit_point(uuid, text, uuid, uuid, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public._resolve_project_house(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public._parse_pipe_m(text);
DROP FUNCTION IF EXISTS public._normalize_unit_size(text);
DROP FUNCTION IF EXISTS public._issue_settings(uuid, uuid);
DROP FUNCTION IF EXISTS public.issue_schedule_state(date, date, int, boolean);
DROP FUNCTION IF EXISTS public.snap_on_or_after(date, int);
DROP FUNCTION IF EXISTS public._issue_today();
DROP FUNCTION IF EXISTS public._first_fit_office();
DROP FUNCTION IF EXISTS public._first_fit_staff();
DROP FUNCTION IF EXISTS public.house_photo_ok(text);

DROP TABLE IF EXISTS public.first_fit_points;
DROP TABLE IF EXISTS public.project_house_units;
DROP TABLE IF EXISTS public.house_photos;
DROP TABLE IF EXISTS public.client_issue_settings;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issue_stage_chk;
DROP INDEX IF EXISTS public.invoices_one_issue_stage;
ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS sibling_invoice_id,
  DROP COLUMN IF EXISTS prep_edited,
  DROP COLUMN IF EXISTS review_flag,
  DROP COLUMN IF EXISTS issue_stage;

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_origin_chk;
DROP INDEX IF EXISTS public.quotes_one_first_fit;
ALTER TABLE public.quotes
  DROP COLUMN IF EXISTS first_fit_edited,
  DROP COLUMN IF EXISTS review_flag,
  DROP COLUMN IF EXISTS origin,
  DROP COLUMN IF EXISTS project_house_id;

ALTER TABLE public.project_houses
  DROP COLUMN IF EXISTS first_fit_hash,
  DROP COLUMN IF EXISTS balance_estimated,
  DROP COLUMN IF EXISTS balance_due_on,
  DROP COLUMN IF EXISTS deposit_due_on,
  DROP COLUMN IF EXISTS is_live,
  DROP COLUMN IF EXISTS first_fit_undone_by,
  DROP COLUMN IF EXISTS first_fit_undone_at,
  DROP COLUMN IF EXISTS first_fit_complete_by,
  DROP COLUMN IF EXISTS first_fit_complete_at;

DROP TRIGGER IF EXISTS job_photos_set_company_t ON public.job_photos;
DROP FUNCTION IF EXISTS public.job_photos_set_company();
DROP POLICY IF EXISTS job_photos_company_scope ON public.job_photos;
DROP INDEX IF EXISTS public.job_photos_company_idx;
ALTER TABLE public.job_photos DROP COLUMN IF EXISTS company_id;

-- Job photo path helper back to the first folder only (the lead id).
CREATE OR REPLACE FUNCTION public.photo_folder_lead(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $f$
  SELECT CASE WHEN split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    THEN split_part(_name, '/', 1)::uuid END
$f$;

CREATE OR REPLACE FUNCTION public.rh_photo_ok(_name text, _owner text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN split_part(_name, '/', 1) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = split_part(_name, '/', 1)::uuid)
    THEN EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = split_part(_name, '/', 1)::uuid
        AND l.company_id = public.caller_company_id()
        AND (NOT public.is_field_tech_only(auth.uid()) OR public.tech_can_see_lead(auth.uid(), l.id))
    )
    ELSE _owner = auth.uid()::text
      OR (
        NOT public.is_field_tech_only(auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id::text = _owner AND p.company_id = public.caller_company_id())
      )
  END
$f$;

DROP POLICY IF EXISTS "p2_photos_insert" ON public.job_photos;
CREATE POLICY "p2_photos_insert" ON public.job_photos FOR INSERT TO authenticated WITH CHECK (
  (uploaded_by IS NULL OR uploaded_by = auth.uid()) AND public.photo_lead_ok(lead_id));
DROP POLICY IF EXISTS "p2_photos_delete" ON public.job_photos;
CREATE POLICY "p2_photos_delete" ON public.job_photos FOR DELETE TO authenticated USING (public.photo_lead_ok(lead_id));
DROP POLICY IF EXISTS "p2_photos_update" ON public.job_photos;
CREATE POLICY "p2_photos_update" ON public.job_photos FOR UPDATE TO authenticated
  USING (public.photo_lead_ok(lead_id)) WITH CHECK (public.photo_lead_ok(lead_id));

DO $pol$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS house_photos_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS house_photos_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS house_photos_delete ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "jp_insert" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "jp_delete" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "jp_update" ON storage.objects';
  EXECUTE 'CREATE POLICY "jp_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)))';
  EXECUTE 'CREATE POLICY "jp_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)))';
  EXECUTE 'CREATE POLICY "jp_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name))) WITH CHECK (bucket_id = ''job-photos'' AND public.photo_lead_ok(public.photo_folder_lead(name)))';
END $pol$;

DROP FUNCTION IF EXISTS public.job_photo_path_company_ok(text);
