-- Add pdf_storage_path to store original PDF URL for live text extraction
ALTER TABLE public.supplier_pdf_pages
ADD COLUMN IF NOT EXISTS pdf_storage_path text;