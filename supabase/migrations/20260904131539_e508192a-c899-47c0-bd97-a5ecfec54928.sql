ALTER TABLE public.pdf_uploads
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_pdf_uploads_active
  ON public.pdf_uploads (supplier_id, brand, is_active);