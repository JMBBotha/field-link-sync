-- 0033 (step 3a): live forecast start date + FNB opening balance R0 (editable in Cash Health > Settings / Overview).
ALTER TABLE public.cf_settings ADD COLUMN IF NOT EXISTS forecast_start date;
UPDATE public.cf_settings SET forecast_start = DATE '2026-11-01' WHERE company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
INSERT INTO public.cf_bank_balances (company_id, account_id, balance, as_of)
SELECT a.company_id, a.id, 0, DATE '2026-11-01' FROM public.cf_bank_accounts a
WHERE a.company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND a.label = 'FNB Business'
  AND NOT EXISTS (SELECT 1 FROM public.cf_bank_balances b WHERE b.account_id = a.id);
