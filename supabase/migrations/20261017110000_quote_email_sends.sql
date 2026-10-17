-- Quote email send record + hard per-quote send lock (Johan 17 Oct 2026, after Q-2026-0039 went out 6 times).
-- Additive only. Rollback: docs/db-releases/2026-10-17_quote_email_sends_rollback.sql
CREATE TABLE IF NOT EXISTS public.quote_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL UNIQUE,                 -- one per Email press; also the Resend Idempotency-Key
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'quote' CHECK (kind IN ('quote', 'deposit')),
  recipient text NOT NULL,
  cc text[],
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  error text,
  attempts integer NOT NULL DEFAULT 1,
  retry_of uuid REFERENCES public.quote_email_sends(id) ON DELETE SET NULL,
  resend_id text,
  created_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- THE lock: at most one queued/sending row per quote, enforced atomically by Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS quote_email_sends_one_active
  ON public.quote_email_sends (quote_id) WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS quote_email_sends_quote_started ON public.quote_email_sends (quote_id, started_at DESC);

ALTER TABLE public.quote_email_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quote_email_sends company read" ON public.quote_email_sends;
CREATE POLICY "quote_email_sends company read" ON public.quote_email_sends FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) OR public.is_company_member(auth.uid(), company_id));
-- No insert/update/delete policies: only the send-quote-email function (service role) writes.

-- Failure alert: in-app notification to the sender + company admins.
CREATE OR REPLACE FUNCTION public.notify_quote_email_failed(p_send uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_num text;
BEGIN
  SELECT * INTO r FROM quote_email_sends WHERE id = p_send;
  IF r.id IS NULL OR r.status <> 'failed' THEN RETURN; END IF;
  SELECT quote_number INTO v_num FROM quotes WHERE id = r.quote_id;
  INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT u, 'quote_email_failed',
         'Quote ' || coalesce(v_num, '') || ' was NOT sent',
         CASE WHEN r.kind = 'deposit' THEN 'Deposit email for quote ' ELSE 'Quote ' END || coalesce(v_num, '') ||
           ' was NOT sent to ' || r.recipient || ': ' || coalesce(r.error, 'unknown error'),
         r.quote_id,
         jsonb_build_object('send_id', r.send_id, 'send_row', r.id, 'recipient', r.recipient, 'reason', r.error, 'kind', r.kind)
  FROM (
    SELECT r.created_by AS u WHERE r.created_by IS NOT NULL
    UNION SELECT cm.user_id FROM company_members cm WHERE cm.company_id = r.company_id AND cm.role = 'admin'
  ) x WHERE u IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.notify_quote_email_failed(uuid) FROM public, anon, authenticated;

-- A 'sending' row with no result after 5 minutes becomes failed, so the lock can never stick.
CREATE OR REPLACE FUNCTION public.expire_stale_quote_email_sends(p_quote_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN UPDATE quote_email_sends
      SET status = 'failed', finished_at = now(),
          error = 'No result from the email service after 5 minutes (timed out). The client may or may not have received it.'
    WHERE status IN ('queued', 'sending') AND started_at < now() - interval '5 minutes'
      AND (p_quote_id IS NULL OR quote_id = p_quote_id)
    RETURNING id
  LOOP
    PERFORM public.notify_quote_email_failed(r.id); n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.expire_stale_quote_email_sends(uuid) FROM public, anon, authenticated;

-- What the UI reads: expires stale rows for this quote first, then returns the active + latest sends.
CREATE OR REPLACE FUNCTION public.quote_email_send_state(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid; v_uid uuid := auth.uid();
BEGIN
  SELECT company_id INTO v_co FROM quotes WHERE id = p_quote_id;
  IF v_uid IS NULL OR v_co IS NULL OR NOT (v_co = public.get_user_company_id(v_uid) OR public.is_company_member(v_uid, v_co)) THEN
    RETURN jsonb_build_object('active', NULL, 'last', NULL);
  END IF;
  PERFORM public.expire_stale_quote_email_sends(p_quote_id);
  RETURN jsonb_build_object(
    'active', (SELECT to_jsonb(s) - 'cc' FROM quote_email_sends s WHERE quote_id = p_quote_id AND status IN ('queued', 'sending') ORDER BY started_at DESC LIMIT 1),
    'last',   (SELECT to_jsonb(s) - 'cc' FROM quote_email_sends s WHERE quote_id = p_quote_id AND kind = 'quote' ORDER BY started_at DESC LIMIT 1),
    'now', now());
END $$;
REVOKE ALL ON FUNCTION public.quote_email_send_state(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.quote_email_send_state(uuid) TO authenticated;

-- Safety net: expire stale sends every 2 minutes even if nobody opens the quote.
DO $$ BEGIN
  PERFORM cron.unschedule('quote-email-sends-expire') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quote-email-sends-expire');
  PERFORM cron.schedule('quote-email-sends-expire', '*/2 * * * *', 'SELECT public.expire_stale_quote_email_sends()');
END $$;
