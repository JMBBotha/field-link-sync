-- Rollback: supabase/manual/20261105220000_dormant_trigger_record_access_rollback.sql
-- Company create failed in production: enforce_company_writable() referenced OLD.invoice_id
-- in a condition that runs for every table. PL/pgSQL resolves that field while executing the
-- condition, so INSERT into company_assistant_config (from _cac_new_company) raised
-- "record old has no field invoice_id" and the company transaction rolled back.
--
-- This replaces only that function. Triggers, policies, and the payment exception stay.
-- Payment INSERT/UPDATE reads company_id and invoice_id from to_jsonb(NEW) inside the
-- payments branch. Payment DELETE is its own branch: to_jsonb(OLD), and if company_id is
-- null the invoice's company is used, then the same archive delete rule as before.
-- Every other table reads company_id from to_jsonb as well, so a field that exists on only
-- one table can never be named on the others. Isolation is unchanged: non-active companies
-- still reject data writes, open archived invoices can still be paid until locked, and
-- entity_outbox / offers / request_offers / request_alerts inserts are still skipped.

CREATE OR REPLACE FUNCTION public.enforce_company_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
  inv uuid;
  old_cid uuid;
  rowj jsonb;
  skip_insert boolean := TG_TABLE_NAME = ANY (ARRAY['entity_outbox', 'offers', 'request_offers', 'request_alerts']);
BEGIN
  IF skip_insert THEN
    IF TG_OP = 'INSERT' THEN
      cid := nullif(to_jsonb(NEW)->>'company_id', '')::uuid;
      IF cid IS NOT NULL AND NOT public.is_company_writable(cid) THEN
        RETURN NULL;
      END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'payments' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    rowj := to_jsonb(NEW);
    cid := nullif(rowj->>'company_id', '')::uuid;
    inv := nullif(rowj->>'invoice_id', '')::uuid;
    IF public.payment_write_ok(cid, inv) THEN
      RETURN NEW;
    END IF;
    IF public.caller_is_service_role() OR coalesce(current_setting('app.archived_import', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Company is archived (history only). Payments are allowed only while an invoice still has a balance, until an admin locks them.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'payments' AND TG_OP = 'DELETE' THEN
    rowj := to_jsonb(OLD);
    cid := nullif(rowj->>'company_id', '')::uuid;
    inv := nullif(rowj->>'invoice_id', '')::uuid;
    IF cid IS NULL AND inv IS NOT NULL THEN
      SELECT i.company_id INTO cid FROM public.invoices i WHERE i.id = inv;
    END IF;
    IF cid IS NOT NULL AND NOT public.is_company_writable(cid)
       AND NOT public.caller_is_service_role()
       AND coalesce(current_setting('app.archived_import', true), '') <> 'on' THEN
      RAISE EXCEPTION 'This company is not active. DELETE on payments is not allowed.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  rowj := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  cid := nullif(rowj->>'company_id', '')::uuid;
  IF TG_OP = 'UPDATE' THEN
    old_cid := nullif(to_jsonb(OLD)->>'company_id', '')::uuid;
    IF old_cid IS NOT NULL
       AND NOT public.is_company_writable(old_cid)
       AND NOT public.caller_is_service_role()
       AND coalesce(current_setting('app.archived_import', true), '') <> 'on' THEN
      RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
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
