-- 2026-10-12 Johan: techs + salespeople can upload AND delete photos (job-photos, quote-photos) only on leads/jobs/appointments assigned to them.
-- Company scoping kept. Backup: *_backup.txt ; rollback: *_rollback.sql

-- who may manage photos on a lead
CREATE OR REPLACE FUNCTION public.photo_lead_ok(_lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL AND _lead IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.company_id = public.caller_company_id())
    AND CASE
      WHEN public.is_field_tech_only(auth.uid()) THEN public.tech_owns_lead(auth.uid(), _lead)
      WHEN public.is_sales_rep(auth.uid()) THEN public.rep_owns_lead(auth.uid(), _lead)
      ELSE public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'dispatcher'::app_role)
    END;
$f$;
REVOKE ALL ON FUNCTION public.photo_lead_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_lead_ok(uuid) TO authenticated;

-- who may manage photos on a quote
CREATE OR REPLACE FUNCTION public.photo_quote_ok(_quote uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.quotes q WHERE q.id = _quote AND q.company_id = public.caller_company_id()
      AND CASE
        WHEN public.is_field_tech_only(auth.uid()) THEN q.lead_id IS NOT NULL AND public.tech_owns_lead(auth.uid(), q.lead_id)
        WHEN public.is_sales_rep(auth.uid()) THEN auth.uid() IN (q.sales_engineer_id, q.owner_id, q.created_by)
                                                 OR (q.lead_id IS NOT NULL AND public.rep_owns_lead(auth.uid(), q.lead_id))
        ELSE public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'dispatcher'::app_role)
      END);
$f$;
REVOKE ALL ON FUNCTION public.photo_quote_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_quote_ok(uuid) TO authenticated;

-- quote-photos path: {company}/{quote}/... or {company}/sections/{quote|unsaved}/...  (same rule for read and write now)
CREATE OR REPLACE FUNCTION public.quote_photo_ok(_name text, _read boolean)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  WITH f AS (SELECT storage.foldername(_name) AS p)
  SELECT auth.uid() IS NOT NULL AND public.caller_company_id() IS NOT NULL
    AND (SELECT p[1] FROM f) = public.caller_company_id()::text
    AND (
      (NOT public.is_field_tech_only(auth.uid()) AND NOT public.is_sales_rep(auth.uid())
        AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'dispatcher'::app_role)))
      OR (SELECT CASE WHEN p[2] = 'sections' THEN p[3] ELSE p[2] END FROM f) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
         AND public.photo_quote_ok((SELECT (CASE WHEN p[2] = 'sections' THEN p[3] ELSE p[2] END)::uuid FROM f))
    );
$f$;

-- job-photos storage ({lead_id}/...)
DROP POLICY IF EXISTS "p2_job_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "jp_insert" ON storage.objects;
CREATE POLICY "jp_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'job-photos' AND public.photo_lead_ok(public.photo_folder_lead(name)));
DROP POLICY IF EXISTS "jp_delete" ON storage.objects;
CREATE POLICY "jp_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'job-photos' AND public.photo_lead_ok(public.photo_folder_lead(name)));
DROP POLICY IF EXISTS "jp_update" ON storage.objects;
CREATE POLICY "jp_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'job-photos' AND public.photo_lead_ok(public.photo_folder_lead(name)))
  WITH CHECK (bucket_id = 'job-photos' AND public.photo_lead_ok(public.photo_folder_lead(name)));

-- job_photos table
DROP POLICY IF EXISTS "p2_photos_insert" ON public.job_photos;
CREATE POLICY "p2_photos_insert" ON public.job_photos FOR INSERT TO authenticated WITH CHECK (
  (uploaded_by IS NULL OR uploaded_by = auth.uid()) AND public.photo_lead_ok(lead_id));
DROP POLICY IF EXISTS "p2_photos_delete" ON public.job_photos;
CREATE POLICY "p2_photos_delete" ON public.job_photos FOR DELETE TO authenticated USING (public.photo_lead_ok(lead_id));
DROP POLICY IF EXISTS "p2_photos_update" ON public.job_photos;
CREATE POLICY "p2_photos_update" ON public.job_photos FOR UPDATE TO authenticated
  USING (public.photo_lead_ok(lead_id)) WITH CHECK (public.photo_lead_ok(lead_id));

-- quote_attachments table
DROP POLICY IF EXISTS "Users can insert quote attachments" ON public.quote_attachments;
CREATE POLICY "Users can insert quote attachments" ON public.quote_attachments FOR INSERT TO authenticated WITH CHECK (public.photo_quote_ok(quote_id));
DROP POLICY IF EXISTS "Users can view quote attachments" ON public.quote_attachments;
CREATE POLICY "Users can view quote attachments" ON public.quote_attachments FOR SELECT TO authenticated USING (public.photo_quote_ok(quote_id));
DROP POLICY IF EXISTS "Users can delete quote attachments" ON public.quote_attachments;
CREATE POLICY "Users can delete quote attachments" ON public.quote_attachments FOR DELETE TO authenticated USING (public.photo_quote_ok(quote_id));
