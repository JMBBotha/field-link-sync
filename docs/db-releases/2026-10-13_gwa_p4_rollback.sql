-- Rollback for 2026-10-13_gwa_p4_payment_followups.sql
SELECT cron.unschedule('payment-followup-flags') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-followup-flags');
DROP TRIGGER IF EXISTS trg_pf_money_gate ON public.notification_queue;
DROP TRIGGER IF EXISTS trg_pf_money_gate ON public.entity_outbox;
DROP FUNCTION IF EXISTS public._pf_money_gate();
DROP FUNCTION IF EXISTS public.pf_claim_send(uuid);
DROP FUNCTION IF EXISTS public.pf_decide(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.pf_request(uuid, text);
DROP FUNCTION IF EXISTS public.pf_flag_overdue();
DROP FUNCTION IF EXISTS public._pf_notify_owners(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public._pf_tone_ok(text);
DROP FUNCTION IF EXISTS public._pf_default_message(text, text, numeric, date, text);
DROP FUNCTION IF EXISTS public._pf_invoice_sent(public.invoices);
DROP FUNCTION IF EXISTS public._pf_invoice_sent(timestamptz, text, text);
DROP FUNCTION IF EXISTS public._pf_amount_due(uuid);
DROP TABLE IF EXISTS public.payment_followups;
DROP FUNCTION IF EXISTS public._pf_owner(uuid);
DROP FUNCTION IF EXISTS public._pf_office(uuid);
-- notifications rows of type 'payment_followup' are left in place (harmless).
