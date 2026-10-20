-- One live price list per supplier PER BRAND (was per supplier), so a Comfee list
-- no longer archives the Samsung list of the same supplier.
DROP INDEX IF EXISTS public.pdf_uploads_one_live_per_supplier;
CREATE UNIQUE INDEX pdf_uploads_one_live_per_supplier_brand ON public.pdf_uploads
  (supplier_id, lower(coalesce(brand,'')), (COALESCE(price_list_type,'') = 'in_house')) WHERE is_active;
CREATE OR REPLACE FUNCTION public.trg_one_live_pricelist() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM true) THEN
    NEW.activated_at := COALESCE(NEW.activated_at, now());
    IF NEW.status = 'archived' THEN NEW.status := 'parsed'; END IF;
    UPDATE public.pdf_uploads SET is_active = false, status = 'archived', updated_at = now()
     WHERE supplier_id IS NOT DISTINCT FROM NEW.supplier_id AND id <> NEW.id AND is_active
       AND lower(coalesce(brand,'')) = lower(coalesce(NEW.brand,''))
       AND (COALESCE(price_list_type,'') = 'in_house') = (COALESCE(NEW.price_list_type,'') = 'in_house');
  END IF;
  RETURN NEW;
END $function$;
