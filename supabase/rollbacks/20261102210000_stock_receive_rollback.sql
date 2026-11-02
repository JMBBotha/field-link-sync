-- Rollback for 20261102210000_stock_receive.sql. Pre-check 2 Nov 2026 21:40 SAST: none of these objects existed before.
-- WARNING: dropping columns discards any receive/stock data recorded after go-live. Stock qty changes made via sjd_receive /
-- job_materials_draw on cf_stock_items.qty_on_hand and cf_commitments/cf_stock_allocations rows are NOT reversed by this script.
DROP FUNCTION IF EXISTS public.cf_can_receive(uuid);
DROP FUNCTION IF EXISTS public.job_materials_draw(uuid, jsonb);
DROP FUNCTION IF EXISTS public.job_materials_plan(uuid);
DROP FUNCTION IF EXISTS public._job_stock_ok(uuid);
DROP FUNCTION IF EXISTS public.sjd_receive(uuid, jsonb);
DROP FUNCTION IF EXISTS public._reserve_commitment(uuid, uuid, text, numeric, numeric, uuid, text);
DROP FUNCTION IF EXISTS public._stock_item_for(uuid, uuid, text, text, text, numeric);
DROP INDEX IF EXISTS public.cf_stock_items_product;
ALTER TABLE public.job_materials_used DROP COLUMN IF EXISTS quote_item_id;
ALTER TABLE public.supplier_job_document_lines DROP COLUMN IF EXISTS product_id, DROP COLUMN IF EXISTS unit_cost_excl, DROP COLUMN IF EXISTS cost_source,
  DROP COLUMN IF EXISTS receive_action, DROP COLUMN IF EXISTS receive_job_id, DROP COLUMN IF EXISTS stock_item_id, DROP COLUMN IF EXISTS stock_qty,
  DROP COLUMN IF EXISTS price_flag, DROP COLUMN IF EXISTS price_note, DROP COLUMN IF EXISTS received_at, DROP COLUMN IF EXISTS received_by;
ALTER TABLE public.cf_stock_items DROP COLUMN IF EXISTS product_id, DROP COLUMN IF EXISTS stock_unit, DROP COLUMN IF EXISTS pack_size, DROP COLUMN IF EXISTS last_received_at;
