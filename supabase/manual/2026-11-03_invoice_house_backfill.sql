-- ONE-OFF, NOT A MIGRATION. Run only after the owner approves.
-- Links existing project invoices to their project house, using the "HOUSE NN" tag already in the
-- first line item. Touches invoices.project_house_id ONLY (not a locked column: no totals, lines or numbers change).
-- Scope: one company + one project, passed as psql variables, so no client data lives in the repo.
--   :company_id  :project_id
BEGIN;
CREATE TEMP TABLE _house_backfill ON COMMIT DROP AS
SELECT i.id AS invoice_id, i.invoice_number, h.id AS house_id, h.house_no
FROM public.invoices i
JOIN public.project_houses h
  ON h.project_id = :'project_id'::uuid AND h.company_id = i.company_id
 AND h.house_no = upper(substring(i.line_items->0->>'description' FROM '(?i)HOUSE\s*([0-9]{1,4}[A-Z]?)'))
WHERE i.company_id = :'company_id'::uuid AND i.project_house_id IS NULL AND i.archived_at IS NULL;
SELECT * FROM _house_backfill ORDER BY invoice_number;   -- check against the mapping table first
UPDATE public.invoices i SET project_house_id = b.house_id FROM _house_backfill b WHERE i.id = b.invoice_id;
COMMIT;
-- ROLLBACK (undo): UPDATE public.invoices SET project_house_id = NULL WHERE id IN (<the invoice ids listed above>);
