-- Add missing column to existing audit_log table (no rename, no drop)
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

-- Add indexes matching proposed schema
CREATE INDEX IF NOT EXISTS idx_audit_log_company_action ON public.audit_log(company_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);