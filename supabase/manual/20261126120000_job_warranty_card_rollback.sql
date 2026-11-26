-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- For 20261126120000_job_warranty_card.sql.
-- Drops the job / warranty card table, the company switches, and the private
-- job-cards bucket (including any PDFs already stored there).

DROP POLICY IF EXISTS job_cards_select ON public.job_cards;
DROP POLICY IF EXISTS job_cards_insert ON public.job_cards;
DROP POLICY IF EXISTS job_cards_update ON public.job_cards;
DROP TRIGGER IF EXISTS job_cards_set_updated_at ON public.job_cards;
DROP TABLE IF EXISTS public.job_cards;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_job_card_photo_mode_check;
ALTER TABLE public.companies DROP COLUMN IF EXISTS job_card_photo_mode;
ALTER TABLE public.companies DROP COLUMN IF EXISTS auto_send_job_card;

DO $pol$
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS job_cards_storage_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS job_cards_storage_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS job_cards_storage_update ON storage.objects';
  DELETE FROM storage.objects WHERE bucket_id = 'job-cards';
  DELETE FROM storage.buckets WHERE id = 'job-cards';
END $pol$;

DROP FUNCTION IF EXISTS public.job_card_storage_ok(text);
