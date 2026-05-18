ALTER TABLE public.supplier_pdf_pages
  ADD COLUMN IF NOT EXISTS price_column_bbox jsonb,
  ADD COLUMN IF NOT EXISTS brand text;

CREATE INDEX IF NOT EXISTS idx_supplier_pdf_pages_supplier_page
  ON public.supplier_pdf_pages (supplier_id, page_number);

CREATE INDEX IF NOT EXISTS idx_supplier_pdf_pages_brand
  ON public.supplier_pdf_pages (supplier_id, brand)
  WHERE brand IS NOT NULL;