-- Manual undo for 20261116143000_walda_money_and_stock.sql. Do not run this on a database
-- that already has real WALDA intakes you want to keep. It removes those intakes and the
-- stock movements stamped with them. It does not change invoices or payments.
-- Phase 1 movements with no intake_id are left as they are.

DELETE FROM public.stock_movements WHERE intake_id IS NOT NULL;
DELETE FROM public.stock_units WHERE intake_id IS NOT NULL;
DELETE FROM public.supplier_job_documents d
 USING public.stock_intakes i
 WHERE d.company_id = i.company_id AND d.source_ref IS NOT NULL AND d.source_ref = i.source_ref;
DELETE FROM public.cf_receipts WHERE source = 'walda';

DROP FUNCTION IF EXISTS public.material_pool_on_hand();
DROP FUNCTION IF EXISTS public.record_pool_used(text, numeric, text);
DROP FUNCTION IF EXISTS public.delete_material_average(uuid);
DROP FUNCTION IF EXISTS public.save_material_average(uuid, text, text, numeric, text);
DROP FUNCTION IF EXISTS public.walda_read_material_averages();
DROP FUNCTION IF EXISTS public.walda_record_direct_delivery(text, text, text, uuid, uuid, uuid, jsonb, date, text, text, text);
DROP FUNCTION IF EXISTS public.walda_record_purchase_return(text, text, date, jsonb, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.walda_link_purchase_payment(text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.walda_allocate_unit(text, uuid, text, uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.walda_record_unit_purchase(text, text, date, text, numeric, numeric, uuid, uuid, text, boolean, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.record_material_purchase(text, numeric, text, numeric, date, text, text, text, boolean, uuid, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.walda_record_material_purchase(text, numeric, text, numeric, date, text, text, text, boolean, uuid, text, text, text, numeric);
DROP FUNCTION IF EXISTS public._record_material_purchase(uuid, text, text, numeric, text, numeric, date, text, text, text, boolean, uuid, text, text, text, numeric);
DROP FUNCTION IF EXISTS public.walda_record_expected_money(numeric, date, text, text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public._move_for_intake(uuid, uuid, text, text, uuid, uuid, text, numeric, numeric, uuid, uuid, uuid, uuid, text, numeric);
DROP FUNCTION IF EXISTS public._match_model(text);
DROP FUNCTION IF EXISTS public._pool_item(uuid, text, numeric);
DROP FUNCTION IF EXISTS public._add_doc_line(uuid, uuid, int, text, text, numeric, uuid, numeric, text);
DROP FUNCTION IF EXISTS public._open_supplier_doc(uuid, text, text, text, text, text, date, text, text);
DROP FUNCTION IF EXISTS public._house_install_job(uuid, uuid);
DROP FUNCTION IF EXISTS public._walda_attachment(text, uuid);

DROP TRIGGER IF EXISTS stock_intake_stamp_trg ON public.stock_movements;
DROP FUNCTION IF EXISTS public.stock_intake_stamp();

DROP TABLE IF EXISTS public.stock_intake_lines;
DROP TABLE IF EXISTS public.stock_intakes;
DROP TABLE IF EXISTS public.material_pool_averages;

ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS intake_id;
ALTER TABLE public.stock_units DROP COLUMN IF EXISTS intake_id;
ALTER TABLE public.stock_units DROP COLUMN IF EXISTS project_house_id;
ALTER TABLE public.cf_receipts DROP COLUMN IF EXISTS source_ref;
ALTER TABLE public.cf_receipts DROP COLUMN IF EXISTS customer_id;

ALTER TABLE public.cf_receipts DROP CONSTRAINT IF EXISTS cf_receipts_source_chk;
ALTER TABLE public.cf_receipts DROP CONSTRAINT IF EXISTS cf_receipts_part_chk;
ALTER TABLE public.cf_receipts DROP CONSTRAINT IF EXISTS cf_receipts_status_chk;
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_source_chk CHECK (source IN ('field_lynk','manual','freshbooks'));
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_part_chk CHECK (part IN ('deposit','progress','final','full'));
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_status_chk CHECK (status IN ('expected','received','written_off'));

DROP POLICY IF EXISTS purchase_slips_admin_rw ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'purchase-slips';
