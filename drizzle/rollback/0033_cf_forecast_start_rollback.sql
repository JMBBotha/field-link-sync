-- Rollback 0033. Removes only the seeded R0 opening row (balances typed later by the owner are kept).
DELETE FROM public.cf_bank_balances b USING public.cf_bank_accounts a
 WHERE b.account_id = a.id AND a.company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND a.label = 'FNB Business'
   AND b.balance = 0 AND b.as_of = DATE '2026-11-01' AND b.entered_by IS NULL;
ALTER TABLE public.cf_settings DROP COLUMN IF EXISTS forecast_start;
