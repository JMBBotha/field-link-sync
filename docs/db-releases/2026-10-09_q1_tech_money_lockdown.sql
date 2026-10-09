-- Q1 (2026-10-09): techs cannot create invoices, see own-company revenue or past prices, or derive cost.
-- Idempotent. Rollback: rollback.sql.
-- 1) Techs never read quotes (quote totals = past prices). Cascades to quote_items/versions/areas/attachments/
--    change orders/line items, whose policies look up quotes.
DROP POLICY IF EXISTS rh_tech_block ON public.quotes;
CREATE POLICY rh_tech_block ON public.quotes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())));

-- 2) Techs cannot create, change or delete invoices, payments or quotes.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','invoice_items','company_invoices','fb_invoices','payments','fb_payments','quotes','quote_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rh_tech_no_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY rh_tech_no_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_field_tech_only(auth.uid())))', t);
    EXECUTE format('DROP POLICY IF EXISTS rh_tech_no_update ON public.%I', t);
    EXECUTE format('CREATE POLICY rh_tech_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())))', t);
    EXECUTE format('DROP POLICY IF EXISTS rh_tech_no_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY rh_tech_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())))', t);
  END LOOP;
END $$;

-- 3) No "own authored invoice" exception for techs any more (0 such rows today).
ALTER POLICY tech_lockdown_select ON public.invoices USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
ALTER POLICY tech_lockdown_select ON public.invoice_items USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
ALTER POLICY tech_lockdown_select ON public.payments USING (NOT (SELECT public.is_field_tech_only(auth.uid())));

-- 4) SECURITY DEFINER functions bypass RLS: guard the ones that create invoices/payments or return quote totals.
DO $$ DECLARE f text; d text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.create_deposit_invoice_for_quote(uuid)','public.convert_time_to_invoice_items(uuid,uuid,numeric)','public.record_invoice_payment(uuid,numeric,text,text,date)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF position('/*rh1*/' in d) = 0 THEN
      d := regexp_replace(d, E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(false); /*rh1*/\n');
      EXECUTE d;
    END IF;
  END LOOP;
  d := pg_get_functiondef('public.get_quote_summary(uuid)'::regprocedure);
  IF position('/*rh1*/' in d) = 0 THEN
    d := replace(d, 'WHERE q.id = p_quote_id', 'WHERE q.id = p_quote_id AND NOT public.is_field_tech_only(auth.uid()) /*rh1*/');
    EXECUTE d;
  END IF;
END $$;
