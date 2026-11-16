-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Turns Massair CT quote ageing back off and restores the previous sweep bodies
-- only by dropping the preview helper. Re-apply 20261031110000 if the old
-- sent-date archive must return. Does not un-archive rows and does not drop lead columns.

UPDATE public.sales_automation_settings
   SET quote_aging_enabled = false, updated_at = now()
 WHERE company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';

DROP FUNCTION IF EXISTS public.open_lead_auto_archive_preview(uuid);
