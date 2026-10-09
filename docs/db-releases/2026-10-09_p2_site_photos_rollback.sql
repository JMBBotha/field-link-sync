-- Rollback P2 (restores the original policies exactly)
DROP POLICY IF EXISTS "p2_job_photos_select" ON storage.objects;
CREATE POLICY "Authenticated staff can view job photos" ON storage.objects FOR SELECT USING (
  (bucket_id = 'job-photos'::text) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role)) AND rh_photo_ok(name, owner_id));
DROP POLICY IF EXISTS "p2_job_photos_insert" ON storage.objects;
CREATE POLICY "Agents can upload job photos" ON storage.objects FOR INSERT WITH CHECK (
  (bucket_id = 'job-photos'::text) AND (has_role(auth.uid(), 'field_agent'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
DROP POLICY IF EXISTS "p2_photos_select_staff" ON public.job_photos;
DROP POLICY IF EXISTS "p2_photos_update" ON public.job_photos;
DROP POLICY IF EXISTS "p2_photos_delete" ON public.job_photos;
CREATE POLICY "Admins can delete photos" ON public.job_photos FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "p2_photos_insert" ON public.job_photos;
CREATE POLICY "Agents can upload photos for their jobs" ON public.job_photos FOR INSERT WITH CHECK (
  has_role(auth.uid(), 'field_agent'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
-- site photos (if any) must go before the old CHECK returns:
DELETE FROM public.job_photos WHERE photo_type = 'site';  -- review first; storage files stay
ALTER TABLE public.job_photos DROP CONSTRAINT IF EXISTS job_photos_photo_type_check;
ALTER TABLE public.job_photos ADD CONSTRAINT job_photos_photo_type_check CHECK (photo_type = ANY (ARRAY['before'::text, 'after'::text]));
-- annotation/annotated_path columns left in place (nullable, harmless); drop only if wanted.
DROP FUNCTION IF EXISTS public.photo_folder_lead(text);
DROP FUNCTION IF EXISTS public.caller_sees_lead(uuid);
