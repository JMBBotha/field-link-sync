-- Rollback: back to one live list per supplier. Deactivate extra brand books first if any.
DROP INDEX IF EXISTS public.pdf_uploads_one_live_per_supplier_brand;
CREATE UNIQUE INDEX pdf_uploads_one_live_per_supplier ON public.pdf_uploads
  (supplier_id, (COALESCE(price_list_type,'') = 'in_house')) WHERE is_active;
CREATE OR REPLACE FUNCTION public.trg_one_live_pricelist() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM true) THEN
    NEW.activated_at := COALESCE(NEW.activated_at, now());
    IF NEW.status = 'archived' THEN NEW.status := 'parsed'; END IF;
    UPDATE public.pdf_uploads SET is_active = false, status = 'archived', updated_at = now()
     WHERE supplier_id IS NOT DISTINCT FROM NEW.supplier_id AND id <> NEW.id AND is_active
       AND (COALESCE(price_list_type,'') = 'in_house') = (COALESCE(NEW.price_list_type,'') = 'in_house');
  END IF;
  RETURN NEW;
END $function$;
