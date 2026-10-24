-- Johan 24 Oct 09:10: Cape Estates invoices are the single source. Massair / Cape Estates only. No amounts touched.
-- Backup: docs/db-releases/2026-10-24_cape_cash_health_backup.json (26 receipts, 13 invoices, before).
-- Rollback (data): UPDATE invoices SET expected_deposit_date=NULL, final_unscheduled=false WHERE customer_id='3dde87f5-60cf-5cda-bc54-edd8b0e553cc';
--   then restore each receipt's expected_date + dates_edited=true from the backup JSON.
UPDATE public.invoices SET expected_deposit_date = '2026-11-01', expected_final_date = NULL, final_unscheduled = true
 WHERE customer_id = '3dde87f5-60cf-5cda-bc54-edd8b0e553cc' AND company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
UPDATE public.cf_receipts r SET dates_edited = false FROM public.invoices i
 WHERE r.invoice_id = i.id AND i.customer_id = '3dde87f5-60cf-5cda-bc54-edd8b0e553cc' AND r.company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
SELECT public._cf_sync_core('361bf031-9cdb-4d7f-9bde-9eb95fa4725e');
