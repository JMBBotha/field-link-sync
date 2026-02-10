
-- Add archive columns to supplier_products
ALTER TABLE public.supplier_products 
ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

-- Create index for archive filtering
CREATE INDEX IF NOT EXISTS idx_supplier_products_archived ON public.supplier_products (archived);

-- Create price_list_uploads table if not exists (for import history)
-- It already exists per types.ts, so just ensure we have the right columns
-- The table already has: id, supplier_id, file_name, file_type, status, products_imported, products_updated, products_skipped, error_message, uploaded_by, created_at

-- Add products_archived column to track archiving in import history
ALTER TABLE public.price_list_uploads
ADD COLUMN IF NOT EXISTS products_archived integer NOT NULL DEFAULT 0;
