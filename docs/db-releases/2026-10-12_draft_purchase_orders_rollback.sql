-- Rollback for 20261012220000_draft_purchase_orders.sql (empty po-documents bucket first via Storage UI/API if files exist)
DROP FUNCTION IF EXISTS public.create_draft_pos_for_invoice(uuid);
DROP POLICY IF EXISTS "pod_obj_all" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'po-documents' AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'po-documents');
DROP TABLE IF EXISTS public.purchase_order_documents;
DROP TABLE IF EXISTS public.purchase_order_items;
DROP TABLE IF EXISTS public.purchase_orders;
DROP FUNCTION IF EXISTS public.po_office_ok(uuid);
ALTER TABLE public.jobs DROP COLUMN IF EXISTS awaiting_stock;
ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS product_id;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS order_emails;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS our_account_number;
