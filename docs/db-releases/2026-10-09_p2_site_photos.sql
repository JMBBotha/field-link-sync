-- P2 site photos + annotation (2026-10-09)
ALTER TABLE public.job_photos DROP CONSTRAINT IF EXISTS job_photos_photo_type_check;
ALTER TABLE public.job_photos ADD CONSTRAINT job_photos_photo_type_check CHECK (photo_type = ANY (ARRAY['before','after','site']));
ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS annotation jsonb;
ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS annotated_path text;

-- caller can see the lead under normal leads RLS (SECURITY INVOKER on purpose)
CREATE OR REPLACE FUNCTION public.caller_sees_lead(_lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead) $f$;
GRANT EXECUTE ON FUNCTION public.caller_sees_lead(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.photo_folder_lead(_name text)
 RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $f$ SELECT CASE WHEN (storage.foldername(_name))[1] ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
                   THEN ((storage.foldername(_name))[1])::uuid END $f$;
GRANT EXECUTE ON FUNCTION public.photo_folder_lead(text) TO authenticated;

DROP POLICY IF EXISTS "Agents can upload photos for their jobs" ON public.job_photos;
DROP POLICY IF EXISTS "p2_photos_insert" ON public.job_photos;
CREATE POLICY "p2_photos_insert" ON public.job_photos FOR INSERT TO authenticated WITH CHECK (
  (uploaded_by IS NULL OR uploaded_by = auth.uid())
  AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id())
  AND (public.has_role(auth.uid(), 'admin')
       OR (public.has_role(auth.uid(), 'dispatcher') AND public.caller_sees_lead(lead_id))
       OR (public.has_role(auth.uid(), 'field_agent') AND public.tech_can_see_lead(auth.uid(), lead_id))));

DROP POLICY IF EXISTS "Admins can delete photos" ON public.job_photos;
DROP POLICY IF EXISTS "p2_photos_delete" ON public.job_photos;
CREATE POLICY "p2_photos_delete" ON public.job_photos FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id())
  AND (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin')));

-- annotate own photo (or admin)
DROP POLICY IF EXISTS "p2_photos_update" ON public.job_photos;
CREATE POLICY "p2_photos_update" ON public.job_photos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id())
         AND (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id()));

-- reps see photos on leads they can see; techs on leads they own (incl. install jobs)
DROP POLICY IF EXISTS "p2_photos_select_staff" ON public.job_photos;
CREATE POLICY "p2_photos_select_staff" ON public.job_photos FOR SELECT TO authenticated USING (
  (public.has_role(auth.uid(), 'dispatcher') AND public.caller_sees_lead(lead_id))
  OR (public.has_role(auth.uid(), 'field_agent') AND public.tech_owns_lead(auth.uid(), lead_id)));

-- storage (bucket job-photos stays private)
DROP POLICY IF EXISTS "Agents can upload job photos" ON storage.objects;
DROP POLICY IF EXISTS "p2_job_photos_insert" ON storage.objects;
CREATE POLICY "p2_job_photos_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'job-photos'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'field_agent') OR public.has_role(auth.uid(), 'dispatcher'))
  AND public.photo_folder_lead(name) IS NOT NULL
  AND public.rh_photo_ok(name, auth.uid()::text)
  AND (NOT public.is_sales_rep(auth.uid()) OR public.caller_sees_lead(public.photo_folder_lead(name))));

DROP POLICY IF EXISTS "Authenticated staff can view job photos" ON storage.objects;
DROP POLICY IF EXISTS "p2_job_photos_select" ON storage.objects;
CREATE POLICY "p2_job_photos_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'job-photos'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'field_agent') OR public.has_role(auth.uid(), 'dispatcher'))
  AND public.rh_photo_ok(name, owner_id)
  AND (NOT public.is_sales_rep(auth.uid()) OR public.caller_sees_lead(public.photo_folder_lead(name))));
