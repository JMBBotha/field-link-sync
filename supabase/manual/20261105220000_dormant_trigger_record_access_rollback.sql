-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Restores enforce_company_writable() from 20261105120000_archived_company_dormant.sql.
-- That body reads OLD.invoice_id in a condition that runs for every table, so company
-- create fails again. Use it only to undo 20261105220000_dormant_trigger_record_access.sql.

CREATE OR REPLACE FUNCTION public.enforce_company_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
  inv uuid;
  skip_insert boolean := TG_TABLE_NAME = ANY (ARRAY['entity_outbox', 'offers', 'request_offers', 'request_alerts']);
BEGIN
  IF skip_insert THEN
    IF TG_OP = 'INSERT' THEN
      cid := NEW.company_id;
      IF cid IS NOT NULL AND NOT public.is_company_writable(cid) THEN
        RETURN NULL;
      END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'payments' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    cid := NEW.company_id;
    inv := NEW.invoice_id;
    IF public.payment_write_ok(cid, inv) THEN
      RETURN NEW;
    END IF;
    IF public.caller_is_service_role() OR coalesce(current_setting('app.archived_import', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Company is archived (history only). Payments are allowed only while an invoice still has a balance, until an admin locks them.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'payments' AND TG_OP = 'DELETE' AND OLD.company_id IS NULL AND OLD.invoice_id IS NOT NULL THEN
    SELECT i.company_id INTO cid FROM public.invoices i WHERE i.id = OLD.invoice_id;
    IF cid IS NOT NULL AND NOT public.is_company_writable(cid)
       AND NOT public.caller_is_service_role()
       AND coalesce(current_setting('app.archived_import', true), '') <> 'on' THEN
      RAISE EXCEPTION 'This company is not active. DELETE on payments is not allowed.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  IF TG_OP = 'UPDATE'
     AND OLD.company_id IS NOT NULL
     AND NOT public.is_company_writable(OLD.company_id)
     AND NOT public.caller_is_service_role()
     AND coalesce(current_setting('app.archived_import', true), '') <> 'on' THEN
    RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF cid IS NULL OR public.is_company_writable(cid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.caller_is_service_role() OR coalesce(current_setting('app.archived_import', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;
