-- Rollback Q1 (restores the exact pre-release state)
DROP POLICY IF EXISTS rh_tech_block ON public.quotes;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['company_invoices','fb_invoices','payments','fb_payments','quotes','quote_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rh_tech_no_insert ON public.%I', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['invoices','invoice_items','company_invoices','fb_invoices','payments','fb_payments','quotes','quote_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rh_tech_no_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS rh_tech_no_delete ON public.%I', t);
  END LOOP;
END $$;
-- invoices / invoice_items keep their pre-existing rh_tech_no_insert (recreate exactly as before)
DROP POLICY IF EXISTS rh_tech_no_insert ON public.invoices;
CREATE POLICY rh_tech_no_insert ON public.invoices AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_field_tech_only(auth.uid())));
DROP POLICY IF EXISTS rh_tech_no_insert ON public.invoice_items;
CREATE POLICY rh_tech_no_insert ON public.invoice_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_field_tech_only(auth.uid())));
ALTER POLICY tech_lockdown_select ON public.invoices USING ((NOT (SELECT public.is_field_tech_only(auth.uid()))) OR (agent_id = auth.uid()));
ALTER POLICY tech_lockdown_select ON public.invoice_items USING ((NOT (SELECT public.is_field_tech_only(auth.uid()))) OR (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.agent_id = auth.uid())));
ALTER POLICY tech_lockdown_select ON public.payments USING ((NOT (SELECT public.is_field_tech_only(auth.uid()))) OR (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = payments.invoice_id AND i.agent_id = auth.uid())));
DO $$ DECLARE f text; d text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.create_deposit_invoice_for_quote(uuid)','public.convert_time_to_invoice_items(uuid,uuid,numeric)','public.record_invoice_payment(uuid,numeric,text,text,date)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF position('/*rh1*/' in d) > 0 THEN EXECUTE replace(d, E'  PERFORM public.rh_assert(false); /*rh1*/\n', ''); END IF;
  END LOOP;
  d := pg_get_functiondef('public.get_quote_summary(uuid)'::regprocedure);
  IF position('/*rh1*/' in d) > 0 THEN EXECUTE replace(d, ' AND NOT public.is_field_tech_only(auth.uid()) /*rh1*/', ''); END IF;
END $$;
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_quotes_for_lead(uuid)'::regprocedure);
  IF position('/*rh1*/' in d) > 0 THEN
    EXECUTE replace(d, 'NOT public.is_field_tech_only(auth.uid()) /*rh1*/', '(NOT public.is_field_tech_only(auth.uid()) OR public.tech_can_see_lead(auth.uid(), l.id)) /*rh*/');
  END IF;
END $$;
