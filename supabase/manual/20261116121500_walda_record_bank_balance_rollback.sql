-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Removes walda_record_bank_balance and the source columns. Existing balance amounts stay.
DROP FUNCTION IF EXISTS public.walda_record_bank_balance(numeric, date, uuid, text, text, text);
DROP FUNCTION IF EXISTS public._cf_bank_ref_eq(text, text);
DROP INDEX IF EXISTS public.cf_bank_balances_walda_day;
ALTER TABLE public.cf_bank_balances DROP CONSTRAINT IF EXISTS cf_bank_balances_source_chk;
ALTER TABLE public.cf_bank_balances
  DROP COLUMN IF EXISTS source_ref,
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS source;
