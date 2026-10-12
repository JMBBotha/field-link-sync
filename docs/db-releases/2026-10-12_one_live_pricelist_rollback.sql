BEGIN;
DROP POLICY IF EXISTS one_live_pricelist_pages ON public.supplier_pdf_pages;
DROP INDEX IF EXISTS public.pdf_uploads_one_live_per_supplier;
DROP TRIGGER IF EXISTS trg_one_live_pricelist ON public.pdf_uploads;
DROP FUNCTION IF EXISTS public.trg_one_live_pricelist();
UPDATE public.pdf_uploads u SET is_active = b.is_active, status = b.status, updated_at = b.updated_at, activated_at = b.activated_at
  FROM backup_plist_20261012.pdf_uploads b WHERE b.id = u.id;
COMMIT;
