-- Rollback: supabase/manual/20261105233000_company_list_lock_column_grant_rollback.sql
-- Company Management selects dormant_payments_locked. Since 20260929184808,
-- authenticated has no table-level SELECT on companies; only named columns are
-- granted. This column was added without a grant. Postgres then rejects the whole
-- list with 42501 "permission denied for table companies" (its hint says GRANT
-- SELECT ON the table). That hint would also restore default_rate and the markup
-- columns revoked in 20261009180000. Grant only this flag. Existing SELECT
-- policies are unchanged, so membership still decides which rows are visible.

GRANT SELECT (dormant_payments_locked) ON public.companies TO authenticated;
