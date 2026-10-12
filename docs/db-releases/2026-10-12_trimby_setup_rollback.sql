-- Rollback for Steve Trimby setup (12 Oct 2026). Run BEFORE the PO rollback.
BEGIN;
SELECT set_config('app.invoice_unlock','on',true);
DELETE FROM public.purchase_orders WHERE invoice_id = '497f9c1a-ba67-47aa-a5c6-9aedf411d290';
DELETE FROM public.jobs WHERE id = 'a7db46f4-df76-427b-ab7e-a9d84c3917e6';
DELETE FROM public.leads WHERE id = '0559f00b-020e-44ee-852e-4b6282387faf';
DELETE FROM public.payments WHERE id = '4fb70fbb-73f2-4ce8-bb3a-cc0ddba15053';
DELETE FROM public.invoice_items WHERE invoice_id = '497f9c1a-ba67-47aa-a5c6-9aedf411d290';
DELETE FROM public.invoices WHERE id = '497f9c1a-ba67-47aa-a5c6-9aedf411d290';
DELETE FROM public.customer_locations WHERE id = 'ff05adb4-5654-4e97-8de0-f2a4e250542c';
DELETE FROM public.customers WHERE id = '21361452-e6f0-4ea9-8ba9-b5da417d9144';
COMMIT;
