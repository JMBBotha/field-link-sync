-- Price-list brand separation (Johan 20 Oct 09:51).
-- 1) Category on price lists (aircon / heat_pump / solar / other), default aircon.
ALTER TABLE public.pdf_uploads
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'aircon';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pdf_uploads_category_check') THEN
    ALTER TABLE public.pdf_uploads
      ADD CONSTRAINT pdf_uploads_category_check CHECK (category IN ('aircon','heat_pump','solar','other'));
  END IF;
END $$;

-- 2) Backfill brand on lists with no brand, only where all their products share ONE brand.
UPDATE public.pdf_uploads u
SET brand = x.b
FROM (
  SELECT pdf_upload_id, min(brand) AS b
  FROM public.supplier_products
  WHERE pdf_upload_id IS NOT NULL AND brand IS NOT NULL AND btrim(brand) <> ''
  GROUP BY pdf_upload_id
  HAVING count(DISTINCT brand) = 1
) x
WHERE u.id = x.pdf_upload_id AND u.brand IS NULL;

-- 3) Page images inherit their list's brand where missing (needed for brand-scoped replace).
UPDATE public.supplier_pdf_pages p
SET brand = u.brand
FROM public.pdf_uploads u
WHERE p.pdf_upload_id = u.id AND p.brand IS NULL AND u.brand IS NOT NULL;
