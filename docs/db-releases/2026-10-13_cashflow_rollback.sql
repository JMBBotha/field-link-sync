-- Rollback for 2026-10-13_cashflow.sql (drops only what it added; no existing data touched except bank lines matched to bills, which go back to 'new')
UPDATE public.bank_lines SET status='new', matched_by=NULL, matched_at=NULL, created_record=false WHERE matched_bill_payment_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_po_received_bill ON public.purchase_orders;
DROP FUNCTION IF EXISTS public.trg_po_received_bill();
DROP FUNCTION IF EXISTS public.job_profit(uuid, date, date);
DROP FUNCTION IF EXISTS public.cashflow_data(uuid);
DROP FUNCTION IF EXISTS public.delete_bill_payment(uuid);
DROP FUNCTION IF EXISTS public.record_bill_payment(uuid, numeric, date, text, text, uuid);
ALTER TABLE public.bank_lines DROP COLUMN IF EXISTS matched_bill_payment_id;
DROP TABLE IF EXISTS public.supplier_bill_payments;
DROP TABLE IF EXISTS public.supplier_bills;
DROP FUNCTION IF EXISTS public.trg_sbp_recalc();
DROP FUNCTION IF EXISTS public._sb_recalc(uuid);
DROP FUNCTION IF EXISTS public.trg_sb_defaults();
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS payment_terms_days;
DROP FUNCTION IF EXISTS public._cf_check(uuid);
DROP FUNCTION IF EXISTS public._cf_ok(uuid);
