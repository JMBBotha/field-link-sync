-- Rollback accounting step 2. Credit notes are archived (table renamed), never deleted.
DROP TRIGGER IF EXISTS trg_recalc_invoice_status_cn ON public.credit_notes;
DO $r$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT ON (object) object, definition FROM public._acct_backups WHERE step = 'acct2' ORDER BY object, id LOOP
    EXECUTE r.definition;
  END LOOP;
END $r$;
DROP FUNCTION IF EXISTS public.issue_credit_note(uuid, numeric, text, text, date);
DROP FUNCTION IF EXISTS public.void_credit_note(uuid, text);
DROP FUNCTION IF EXISTS public._acct_office_check(uuid);
REVOKE ALL ON public.credit_notes FROM authenticated;
ALTER TABLE public.credit_notes RENAME TO credit_notes_archived_acct2;
DROP FUNCTION IF EXISTS public.invoice_amount_credited(uuid);
-- Re-run status for invoices that had credits so they show the cash-only status again:
UPDATE public.payments SET amount = amount WHERE invoice_id IN (SELECT invoice_id FROM public.credit_notes_archived_acct2);
