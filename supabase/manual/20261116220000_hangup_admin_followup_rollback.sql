-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Rolls back 20261116220000_hangup_admin_followup.sql. Does not delete leads or customers.

DROP TRIGGER IF EXISTS leads_mark_alerts_read ON public.leads;
DROP FUNCTION IF EXISTS public.mark_lead_alerts_read();

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.process_sales_escalations()'::regprocedure);
  IF position('lead_skips_hot_escalation' IN d) > 0 THEN
    d := replace(d, ' and not public.lead_skips_hot_escalation(l.id)', '');
    EXECUTE d;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.lead_skips_hot_escalation(uuid);
DROP FUNCTION IF EXISTS public.convert_call_admin_followup(uuid);
DROP FUNCTION IF EXISTS public.dismiss_call_admin_followup(uuid);
DROP FUNCTION IF EXISTS public._followup_admin_ok(uuid);
DROP FUNCTION IF EXISTS public.log_call_admin_followup(uuid, text, timestamptz, integer, uuid, text);
DROP FUNCTION IF EXISTS public.match_customer_by_phone(uuid, text);
DROP FUNCTION IF EXISTS public.address_is_empty(text);
DROP FUNCTION IF EXISTS public.caller_name_missing(text);
DROP TABLE IF EXISTS public.call_admin_followups;
