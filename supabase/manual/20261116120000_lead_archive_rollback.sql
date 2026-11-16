-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Rolls back 20261116120000_lead_archive.sql. Does not touch quotes, invoices, or payments.

REVOKE ALL ON FUNCTION public.lead_unarchive(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_archive(uuid, text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.lead_unarchive(uuid);
DROP FUNCTION IF EXISTS public.lead_archive(uuid, text);
DROP INDEX IF EXISTS public.idx_leads_company_not_archived;
ALTER TABLE public.leads DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE public.leads DROP COLUMN IF EXISTS archived_by;
ALTER TABLE public.leads DROP COLUMN IF EXISTS archived_at;
