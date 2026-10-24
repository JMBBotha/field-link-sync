-- Rollback 0030. Drops only what 0030 added. Any dates typed in are lost (amounts were never touched).
DROP FUNCTION IF EXISTS public.set_customer_final_after_days(uuid, int);
DROP FUNCTION IF EXISTS public.set_invoice_payment_dates(uuid, date, int, date);
DROP FUNCTION IF EXISTS public.invoice_payment_schedule(uuid);
DROP FUNCTION IF EXISTS public._inv_pay_schedule(uuid);
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_final_after_days_chk, DROP COLUMN IF EXISTS final_after_days;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_final_after_days_chk,
  DROP COLUMN IF EXISTS expected_deposit_date, DROP COLUMN IF EXISTS expected_final_date, DROP COLUMN IF EXISTS final_after_days;
