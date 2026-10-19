-- Rollback: Cash-flow health phase 1 (20261019110000_cash_health.sql + Massair seed).
-- Drops only the new cf_* objects. Invoices, payments, quotes, jobs, POs, supplier bills are never touched by this module.
BEGIN;
DROP FUNCTION IF EXISTS public.cf_vat_actuals(uuid, date, date);
DROP FUNCTION IF EXISTS public.cf_stock_take(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.cf_unallocate_stock(uuid);
DROP FUNCTION IF EXISTS public.cf_allocate_stock(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.cf_sync(uuid);
DROP FUNCTION IF EXISTS public._cf_sync_core(uuid);
DROP TABLE IF EXISTS public.cf_stock_allocations;
DROP TABLE IF EXISTS public.cf_stock_items;
DROP TABLE IF EXISTS public.cf_commitments;
DROP TABLE IF EXISTS public.cf_receipts;
DROP TABLE IF EXISTS public.cf_overheads;
DROP TABLE IF EXISTS public.cf_bank_balances;
DROP TABLE IF EXISTS public.cf_bank_accounts;
DROP TABLE IF EXISTS public.cf_settings;
DROP FUNCTION IF EXISTS public._cf_commitment_drawdown();
DROP FUNCTION IF EXISTS public._cf_touch();
DROP FUNCTION IF EXISTS public._cf_settings_guard();
COMMIT;
-- Switch off only (keep data): UPDATE public.cf_settings SET enabled = false WHERE company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
