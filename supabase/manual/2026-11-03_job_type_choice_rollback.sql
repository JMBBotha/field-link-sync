-- Rollback for supabase/migrations/20261103143000_job_type_choice.sql
-- Leads already created by these functions are kept (they are real sales leads); only the column tag is dropped.
DROP FUNCTION IF EXISTS public.tech_flag_sales_lead(uuid, text);
DROP FUNCTION IF EXISTS public.decide_job_type_change(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.request_job_type_change(uuid, text, text);
DROP FUNCTION IF EXISTS public._job_sales_lead(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public._job_tech_ok(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.job_type_change_requests;
ALTER TABLE public.leads DROP COLUMN IF EXISTS raised_by_tech;
