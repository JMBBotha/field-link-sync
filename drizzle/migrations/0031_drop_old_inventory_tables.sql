-- 0031: remove the old, empty, non-company-scoped stock tables.
-- Stock is tracked in Cash Health (cf_*). Verified 2026-10-24: all three tables have 0 rows,
-- the only inbound FK is inventory_adjustments -> inventory_stock, and no functions/views use them.
-- Schema backup: docs/db-releases/0031_old_inventory_schema_backup.json. Rollback: drizzle/rollback/0031_*.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.inventory_stock) > 0
     OR (SELECT count(*) FROM public.inventory_items) > 0
     OR (SELECT count(*) FROM public.inventory_adjustments) > 0 THEN
    RAISE EXCEPTION '0031 aborted: old inventory tables are not empty';
  END IF;
END $$;
DROP TABLE public.inventory_adjustments;
DROP TABLE public.inventory_stock;
DROP TABLE public.inventory_items;
