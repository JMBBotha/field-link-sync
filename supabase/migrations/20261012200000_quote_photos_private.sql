-- 2026-10-12 quote-photos lockdown (feature step 1) + job-photos company scoping
-- Backup of the prior state: 2026-10-12_quote_photos_private_backup.txt ; rollback: *_rollback.sql
-- quote-photos had 0 objects and quote_attachments 0 rows when applied.

UPDATE storage.buckets SET public = false WHERE id = 'quote-photos';

-- path: {company_id}/{quote_id}/{uuid}.jpg  or  {company_id}/sections/{quote_id|unsaved}/{uuid}.jpg
-- _read: technicians may read photos of a quote whose lead they own (assigned job); writes are office staff only.
CREATE OR REPLACE FUNCTION public.quote_photo_ok(_name text, _read boolean)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL
    AND public.caller_company_id() IS NOT NULL
    AND (storage.foldername(_name))[1] = public.caller_company_id()::text
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'dispatcher'::app_role)
      OR (_read AND public.has_role(auth.uid(), 'field_agent'::app_role)
          AND (storage.foldername(_name))[2] ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
          AND EXISTS (SELECT 1 FROM public.quotes q
                      WHERE q.id = ((storage.foldername(_name))[2])::uuid
                        AND q.company_id = public.caller_company_id()
                        AND q.lead_id IS NOT NULL
                        AND public.tech_owns_lead(auth.uid(), q.lead_id)))
    );
$f$;
REVOKE ALL ON FUNCTION public.quote_photo_ok(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_photo_ok(text, boolean) TO authenticated;

DROP POLICY IF EXISTS "Auth users can upload quote photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete own quote photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view quote photos" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users can list public assets" ON storage.objects;
CREATE POLICY "Signed-in users can list public assets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['company-logos'::text, 'product-images'::text]));

DROP POLICY IF EXISTS "qp_select" ON storage.objects;
DROP POLICY IF EXISTS "qp_insert" ON storage.objects;
DROP POLICY IF EXISTS "qp_update" ON storage.objects;
DROP POLICY IF EXISTS "qp_delete" ON storage.objects;
CREATE POLICY "qp_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quote-photos' AND public.quote_photo_ok(name, true));
CREATE POLICY "qp_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quote-photos' AND public.quote_photo_ok(name, false));
CREATE POLICY "qp_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'quote-photos' AND public.quote_photo_ok(name, false))
  WITH CHECK (bucket_id = 'quote-photos' AND public.quote_photo_ok(name, false));
CREATE POLICY "qp_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quote-photos' AND public.quote_photo_ok(name, false));

-- job-photos: delete/update had no company check
DROP POLICY IF EXISTS "Admins can delete job photos" ON storage.objects;
DROP POLICY IF EXISTS "jp_delete" ON storage.objects;
CREATE POLICY "jp_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-photos' AND public.has_role(auth.uid(), 'admin'::app_role) AND public.rh_photo_ok(name, owner_id));
DROP POLICY IF EXISTS "Uploaders can update their photos" ON storage.objects;
DROP POLICY IF EXISTS "jp_update" ON storage.objects;
CREATE POLICY "jp_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'job-photos' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin'::app_role)) AND public.rh_photo_ok(name, owner_id))
  WITH CHECK (bucket_id = 'job-photos' AND public.rh_photo_ok(name, auth.uid()::text));
