-- Rollback: Massair CT (company 361bf031-9cdb-4d7f-9bde-9eb95fa4725e) hourly rate change, 2026-10-12
-- Forward change (applied 2026-10-12 ~16:50 SAST, approved by Johan):
--   UPDATE company_settings SET default_hourly_rate = 680 WHERE id = 'a70c9005-45a7-444a-8b49-249a83b490b0';
-- Backup of prior value: default_hourly_rate = 450 (updated_at 2026-10-12T14:36:31.113546+00:00)
-- companies.default_rate was already 680 and was not touched.
UPDATE company_settings
   SET default_hourly_rate = 450
 WHERE id = 'a70c9005-45a7-444a-8b49-249a83b490b0'
   AND company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'
   AND default_hourly_rate = 680;
