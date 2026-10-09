-- Rollback accounting step 1: restore the three functions from the backup, drop the stage RPC, plan check and column.
DO $r$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT ON (object) object, definition FROM public._acct_backups WHERE step = 'acct1' ORDER BY object, id LOOP
    EXECUTE r.definition;
  END LOOP;
END $r$;
DROP FUNCTION IF EXISTS public.create_stage_invoice_for_quote(uuid);
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_payment_plan_ok;
DROP FUNCTION IF EXISTS public.payment_plan_ok(jsonb);
-- Archive, never delete: the column is kept (rename) so any plans chosen stay readable.
ALTER TABLE public.quotes RENAME COLUMN payment_plan TO payment_plan_archived_acct1;
