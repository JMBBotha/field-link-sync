-- Rollback for 20261103120000_job_delivered_units.sql
DROP TRIGGER IF EXISTS trg_jdu_capture ON public.supplier_job_document_lines;
DROP FUNCTION IF EXISTS public.jdu_capture();
DROP TABLE IF EXISTS public.job_delivered_units;
ALTER TABLE public.supplier_job_document_lines DROP COLUMN IF EXISTS serial_no;
