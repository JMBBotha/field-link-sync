-- Add unique constraint on supplier_id + product_code for upsert support
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_products_supplier_id_product_code_key'
  ) THEN
    ALTER TABLE public.supplier_products
      ADD CONSTRAINT supplier_products_supplier_id_product_code_key UNIQUE (supplier_id, product_code);
  END IF;
END $$;