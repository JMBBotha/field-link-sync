-- Rollback photo_assigned_upload_delete: back to the state after 2026-10-12_quote_photos_private.sql
DROP POLICY IF EXISTS "Users can insert quote attachments" ON public.quote_attachments;
DROP POLICY IF EXISTS "Users can view quote attachments" ON public.quote_attachments;
DROP POLICY IF EXISTS "Users can delete quote attachments" ON public.quote_attachments;
CREATE POLICY "Users can insert quote attachments" ON public.quote_attachments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_attachments.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can view quote attachments" ON public.quote_attachments FOR SELECT USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_attachments.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can delete quote attachments" ON public.quote_attachments FOR DELETE USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = quote_attachments.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

DROP POLICY IF EXISTS "p2_photos_insert" ON public.job_photos;
CREATE POLICY "p2_photos_insert" ON public.job_photos FOR INSERT TO authenticated WITH CHECK (
  (uploaded_by IS NULL OR uploaded_by = auth.uid())
  AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id())
  AND (public.has_role(auth.uid(), 'admin') OR (public.has_role(auth.uid(), 'dispatcher') AND public.caller_sees_lead(lead_id))
       OR (public.has_role(auth.uid(), 'field_agent') AND public.tech_can_see_lead(auth.uid(), lead_id))));
DROP POLICY IF EXISTS "p2_photos_delete" ON public.job_photos;
CREATE POLICY "p2_photos_delete" ON public.job_photos FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id())
  AND (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "p2_photos_update" ON public.job_photos;
CREATE POLICY "p2_photos_update" ON public.job_photos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id())
         AND (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id()));

DROP POLICY IF EXISTS "jp_insert" ON storage.objects;
CREATE POLICY "p2_job_photos_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'job-photos'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'field_agent') OR public.has_role(auth.uid(), 'dispatcher'))
  AND public.photo_folder_lead(name) IS NOT NULL AND public.rh_photo_ok(name, auth.uid()::text)
  AND (NOT public.is_sales_rep(auth.uid()) OR public.caller_sees_lead(public.photo_folder_lead(name))));
DROP POLICY IF EXISTS "jp_delete" ON storage.objects;
CREATE POLICY "jp_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-photos' AND public.has_role(auth.uid(), 'admin'::app_role) AND public.rh_photo_ok(name, owner_id));
DROP POLICY IF EXISTS "jp_update" ON storage.objects;
CREATE POLICY "jp_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'job-photos' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin'::app_role)) AND public.rh_photo_ok(name, owner_id))
  WITH CHECK (bucket_id = 'job-photos' AND public.rh_photo_ok(name, auth.uid()::text));

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
DROP FUNCTION IF EXISTS public.photo_quote_ok(uuid);
DROP FUNCTION IF EXISTS public.photo_lead_ok(uuid);
