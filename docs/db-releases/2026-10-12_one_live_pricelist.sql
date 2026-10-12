-- One live PDF price list per supplier (12 Oct 2026). Rollback: 2026-10-12_one_live_pricelist_rollback.sql
-- The master catalogue is shared (suppliers have no company_id), so "per company and supplier" = per supplier.
-- In-house extras lists (price_list_type 'in_house') count as their own slot. Nothing is deleted.
CREATE SCHEMA IF NOT EXISTS backup_plist_20261012;
CREATE TABLE IF NOT EXISTS backup_plist_20261012.pdf_uploads AS SELECT * FROM public.pdf_uploads;

-- 1. Archive leftovers: every non-newest active-or-parsed upload per supplier slot
UPDATE public.pdf_uploads u SET is_active = false, status = 'archived', updated_at = now()
 WHERE u.status IS DISTINCT FROM 'archived'
   AND u.id <> (SELECT x.id FROM public.pdf_uploads x
                 WHERE x.supplier_id = u.supplier_id
                   AND (COALESCE(x.price_list_type,'') = 'in_house') = (COALESCE(u.price_list_type,'') = 'in_house')
                 ORDER BY x.is_active DESC, COALESCE(x.activated_at, x.created_at) DESC, x.created_at DESC LIMIT 1);

-- 2. Guard: activating a list archives the supplier's previous one; at most one active per slot
CREATE OR REPLACE FUNCTION public.trg_one_live_pricelist() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM true) THEN
    NEW.activated_at := COALESCE(NEW.activated_at, now());
    IF NEW.status = 'archived' THEN NEW.status := 'parsed'; END IF;
    UPDATE public.pdf_uploads SET is_active = false, status = 'archived', updated_at = now()
     WHERE supplier_id IS NOT DISTINCT FROM NEW.supplier_id AND id <> NEW.id AND is_active
       AND (COALESCE(price_list_type,'') = 'in_house') = (COALESCE(NEW.price_list_type,'') = 'in_house');
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_one_live_pricelist ON public.pdf_uploads;
CREATE TRIGGER trg_one_live_pricelist BEFORE INSERT OR UPDATE OF is_active ON public.pdf_uploads
  FOR EACH ROW EXECUTE FUNCTION public.trg_one_live_pricelist();
CREATE UNIQUE INDEX IF NOT EXISTS pdf_uploads_one_live_per_supplier
  ON public.pdf_uploads (supplier_id, (COALESCE(price_list_type,'') = 'in_house')) WHERE is_active;

-- 3. Every read of price-list pages (Visual PDF, bundle picker, importer, documents tab) sees only the live list
DROP POLICY IF EXISTS one_live_pricelist_pages ON public.supplier_pdf_pages;
CREATE POLICY one_live_pricelist_pages ON public.supplier_pdf_pages AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (pdf_upload_id IS NULL OR EXISTS (SELECT 1 FROM public.pdf_uploads u WHERE u.id = supplier_pdf_pages.pdf_upload_id AND u.is_active));
