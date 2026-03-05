
-- Supplier pricing columns
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS price_list_type TEXT DEFAULT 'cost_price';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_trade_discount NUMERIC(5,2) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_markup_percent NUMERIC(5,2) DEFAULT 20;
