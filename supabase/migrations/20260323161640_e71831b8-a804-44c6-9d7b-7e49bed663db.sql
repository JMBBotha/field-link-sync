
-- Add updated_at trigger on product_brochures
CREATE TRIGGER update_product_brochures_updated_at
  BEFORE UPDATE ON product_brochures
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add sort order index on quote_brochures
CREATE INDEX idx_quote_brochures_sort ON quote_brochures (sort_order);

-- Add brand check constraint
ALTER TABLE product_brochures ADD CONSTRAINT chk_brochure_brand
  CHECK (brand IN ('Samsung', 'Alliance', 'Comfee'));
