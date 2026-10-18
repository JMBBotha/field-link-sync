-- Rollback Site Survey phase 2. Storage objects in site-surveys must be removed first (Storage API / dashboard).
DROP POLICY IF EXISTS ss_obj_select ON storage.objects;
DROP POLICY IF EXISTS ss_obj_insert ON storage.objects;
DROP POLICY IF EXISTS ss_obj_update ON storage.objects;
DROP POLICY IF EXISTS ss_obj_delete ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'site-surveys' AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'site-surveys');
DROP TABLE IF EXISTS public.site_survey_media;
DROP TABLE IF EXISTS public.site_survey_rooms;
DROP TABLE IF EXISTS public.site_surveys;
DROP FUNCTION IF EXISTS public.ss_folder_ok(text);
DROP FUNCTION IF EXISTS public.ss_folder_survey(text);
DROP FUNCTION IF EXISTS public.ss_can_write(uuid);
DROP FUNCTION IF EXISTS public.ss_report_no();
DROP FUNCTION IF EXISTS public.ss_fill_company();
