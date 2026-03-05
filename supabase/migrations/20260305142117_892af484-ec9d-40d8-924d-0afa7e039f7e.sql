
ALTER TABLE bundle_items
  DROP CONSTRAINT bundle_items_supplier_product_id_fkey,
  ADD CONSTRAINT bundle_items_supplier_product_id_fkey
    FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id) ON DELETE CASCADE;

ALTER TABLE job_used_parts
  DROP CONSTRAINT job_used_parts_product_id_fkey,
  ADD CONSTRAINT job_used_parts_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES supplier_products(id) ON DELETE SET NULL;

ALTER TABLE stock_receipts
  DROP CONSTRAINT stock_receipts_supplier_id_fkey,
  ADD CONSTRAINT stock_receipts_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
