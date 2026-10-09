-- acct4 rollback: archive the table (rename), drop policies/trigger/functions added by this step.
DROP POLICY IF EXISTS acct4_expense_receipts_office ON storage.objects;
DROP TRIGGER IF EXISTS trg_expenses_compute ON public.expenses;
ALTER TABLE IF EXISTS public.expenses RENAME TO expenses_archived_acct4;
DROP FUNCTION IF EXISTS public._expenses_compute();
DROP FUNCTION IF EXISTS public._acct_receipt_ok(text, text);
-- vat_rate_for / _acct_is_office are also used by steps 5-6; drop only if those are rolled back too:
-- DROP FUNCTION IF EXISTS public.vat_rate_for(date); DROP FUNCTION IF EXISTS public._acct_is_office(uuid);
