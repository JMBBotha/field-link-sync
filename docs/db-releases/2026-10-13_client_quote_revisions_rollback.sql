-- Rollback for 2026-10-13_client_quote_revisions.sql
-- 1) Optional: restore a quote changed by an approved revision (lines + totals) BEFORE dropping:
--   DELETE FROM quote_items WHERE quote_id = '<quote>';
--   INSERT INTO quote_items SELECT * FROM jsonb_populate_recordset(NULL::quote_items, (SELECT original_items FROM quote_client_revisions WHERE id='<rev>'));
--   UPDATE quotes q SET subtotal=(t->>'subtotal')::numeric, vat_amount=(t->>'vat_amount')::numeric, total=(t->>'total')::numeric, labour_included=(t->>'labour_included')::boolean
--     FROM (SELECT original_totals t FROM quote_client_revisions WHERE id='<rev>') x WHERE q.id='<quote>';
DROP FUNCTION IF EXISTS public.decide_client_revision(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.submit_client_revision(uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.public_quote_adjust_data(uuid);
DROP FUNCTION IF EXISTS public.qcr_pricing(uuid);
DROP FUNCTION IF EXISTS public.qcr_is_unit(text, text, boolean, integer, text);
ALTER TABLE IF EXISTS public.quote_client_revisions RENAME TO quote_client_revisions_rolledback;
