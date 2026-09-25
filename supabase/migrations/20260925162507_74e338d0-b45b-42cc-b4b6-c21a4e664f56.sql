ALTER TABLE public.supplier_products ADD CONSTRAINT supplier_products_live_requires_pdf CHECK (coalesce(archived,false) = true OR pdf_upload_id IS NOT NULL) NOT VALID;
ALTER TABLE public.supplier_products VALIDATE CONSTRAINT supplier_products_live_requires_pdf;
UPDATE public.supplier_products SET brand = 'Daikin' WHERE coalesce(archived,false)=false AND brand = 'DAIKIN';
UPDATE public.supplier_products SET brand = 'One Stop Shop' WHERE coalesce(archived,false)=false AND brand ILIKE 'one stop shop%' AND brand <> 'One Stop Shop';
UPDATE public.supplier_products SET brand = btrim(brand) WHERE coalesce(archived,false)=false AND brand <> btrim(brand);