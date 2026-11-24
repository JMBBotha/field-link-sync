-- Johan: when an invoice is created, the quote should be accepted automatically.
--
-- A live invoice (deposit or full) inserted for a quote, or later linked to one,
-- marks that quote accepted the same way the Mark accepted button does:
--   status accepted, accepted_at, accepted_by 'system:invoice <number>',
--   locked (reason accepted) by trg_quotes_autolock_on_accept,
--   a quote_stage_events row from trg_quote_stage_log,
--   an audit_log row from audit_quotes,
--   a status_change_log row (the button writes this from the app),
--   follow-ups closed ('quoted' -> 'closed') by quotes_followup_on_send,
--   and the existing "Quote Accepted" notice to the rep.
--
-- It does not change the invoice. It does not email, WhatsApp or SMS the client.
-- Cancelled and void invoices do not accept a quote.
-- Archived, declined and lost quotes are left as they are.
-- The quote update is a normal UPDATE, so enforce_company_writable and the
-- other quote triggers still run. No bypass setting is used.
--
-- The accept trigger on_quote_accepted calls create_deposit_invoice_for_quote,
-- which inserts a deposit invoice and then isa_queue (the 15-minute client send).
-- That function already returns the existing live invoice before isa_queue.
-- This trigger is AFTER INSERT / AFTER UPDATE, so that row is visible inside
-- the same transaction and the existing check would skip both the second
-- invoice and the send. create_deposit_invoice_for_quote still runs
-- rh_assert and a company check before that return, and either can raise
-- and roll the new invoice back. create_invoice_from_accepted_quote therefore
-- returns before the call when a live invoice is already on the quote
-- (or this trigger has set app.invoice_already_exists).

CREATE OR REPLACE FUNCTION public.accept_quote_on_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  q public.quotes%ROWTYPE;
  v_status text;
  v_who text;
BEGIN
  IF NEW.quote_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- A cancelled or void invoice is not an acceptance.
  IF lower(COALESCE(NEW.status, '')) IN ('void', 'cancelled', 'canceled') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Linking the invoice to a quote, or a void invoice becoming live.
    -- Any other edit leaves the quote alone and does not touch this invoice.
    IF OLD.quote_id IS NOT DISTINCT FROM NEW.quote_id
       AND lower(COALESCE(OLD.status, '')) NOT IN ('void', 'cancelled', 'canceled') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT * INTO q FROM public.quotes WHERE id = NEW.quote_id FOR UPDATE;
  IF NOT FOUND OR q.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_status := lower(COALESCE(q.status, ''));
  -- Already accepted, or a closed outcome. Lost is declined on the board;
  -- the status is skipped too if a row ever carries it.
  IF v_status IN (
    'accepted', 'declined', 'lost', 'rejected', 'cancelled', 'canceled',
    'void', 'superseded', 'option_not_chosen', 'archived'
  ) THEN
    RETURN NEW;
  END IF;
  -- Open quotes only. Viewed is a sent quote the client has opened.
  IF v_status NOT IN ('draft', 'sent', 'viewed') THEN
    RETURN NEW;
  END IF;

  v_who := 'system:invoice ' || COALESCE(NULLIF(btrim(NEW.invoice_number), ''), 'unnumbered');

  -- Set before the quote update. The nested accept trigger reads it and does
  -- not create a deposit invoice or queue the 15-minute client send.
  PERFORM set_config('app.invoice_already_exists', q.id::text, true);

  UPDATE public.quotes
     SET status = 'accepted',
         accepted_at = COALESCE(accepted_at, now()),
         accepted_by = v_who
   WHERE id = q.id
     AND archived_at IS NULL
     AND lower(COALESCE(status, '')) IN ('draft', 'sent', 'viewed');
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.status_change_log (entity_type, entity_id, field_name, old_status, new_status, changed_by, company_id)
  VALUES ('quote', q.id, 'status', q.status, 'accepted', v_who, q.company_id);

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_quote_on_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_accept_quote_on_invoice ON public.invoices;
CREATE TRIGGER trg_accept_quote_on_invoice
  AFTER INSERT OR UPDATE OF quote_id, status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.accept_quote_on_invoice();

COMMENT ON FUNCTION public.accept_quote_on_invoice() IS
  'When a live invoice is created for or linked to a draft, sent or viewed quote, mark the quote accepted. Does not change the invoice, and does not send anything to the client.';

-- Skip the deposit invoice and isa_queue when a live invoice is already there.
-- The same SELECT is the guard inside create_deposit_invoice_for_quote. It sees
-- a row inserted earlier in this transaction because trg_accept_quote_on_invoice
-- is an AFTER trigger. The setting covers that call even if this function ran
-- before the invoice row was visible, and it keeps rh_assert from raising.
CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_variation THEN RETURN NEW; END IF; /*r2: site-check updated quotes never create a deposit invoice*/
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    IF current_setting('app.invoice_already_exists', true) = NEW.id::text
       OR EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.quote_id = NEW.id
            AND COALESCE(i.status, '') NOT IN ('void', 'cancelled')
       ) THEN
      RETURN NEW;
    END IF;
    PERFORM public.create_deposit_invoice_for_quote(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
