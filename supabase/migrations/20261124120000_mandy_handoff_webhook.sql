-- Mandy hand-off webhook delivery. Not applied live.
-- Records whether each mandy_handoffs row reached the external webhook, and
-- collapses the same request from the same person within 5 seconds.
-- The URL and HMAC secret stay in the edge function
-- (MANDY_HANDOFF_WEBHOOK_URL, MANDY_HANDOFF_WEBHOOK_SECRET). This migration
-- does not store those secrets, does not call the webhook, and does not
-- schedule a resend.

ALTER TABLE public.mandy_handoffs
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS webhook_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS webhook_error text,
  ADD COLUMN IF NOT EXISTS webhook_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_sent_at timestamptz;

ALTER TABLE public.mandy_handoffs DROP CONSTRAINT IF EXISTS mandy_handoffs_webhook_status_check;
ALTER TABLE public.mandy_handoffs ADD CONSTRAINT mandy_handoffs_webhook_status_check
  CHECK (webhook_status IN ('pending', 'delivered', 'failed', 'skipped'));

ALTER TABLE public.mandy_handoffs DROP CONSTRAINT IF EXISTS mandy_handoffs_webhook_attempts_check;
ALTER TABLE public.mandy_handoffs ADD CONSTRAINT mandy_handoffs_webhook_attempts_check
  CHECK (webhook_attempts >= 0);

-- Keep in step with handoffFingerprint() in supabase/functions/_shared/mandyHandoffWebhook.ts.
CREATE OR REPLACE FUNCTION public.mandy_handoff_fingerprint(p_summary text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(
    regexp_replace(btrim(coalesce(p_summary, '')), '\s+', ' ', 'g'),
    '[.,!?;:]+$',
    ''
  ));
$$;

CREATE OR REPLACE FUNCTION public.mandy_handoff_lock_key(p_user uuid, p_company uuid, p_fp text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT hashtext(coalesce(p_user::text, '') || '|' || coalesce(p_company::text, '') || '|' || coalesce(p_fp, ''));
$$;

REVOKE ALL ON FUNCTION public.mandy_handoff_fingerprint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mandy_handoff_lock_key(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mandy_handoff_fingerprint(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mandy_handoff_lock_key(uuid, uuid, text) TO service_role;

UPDATE public.mandy_handoffs
SET dedupe_key = public.mandy_handoff_fingerprint(summary)
WHERE dedupe_key IS NULL;

CREATE INDEX IF NOT EXISTS mandy_handoffs_dedupe_idx
  ON public.mandy_handoffs (user_id, company_id, dedupe_key, created_at DESC);

CREATE INDEX IF NOT EXISTS mandy_handoffs_undelivered_idx
  ON public.mandy_handoffs (created_at)
  WHERE status = 'open' AND webhook_status IN ('pending', 'failed', 'skipped');

-- Backstop for any insert that skips save_mandy_handoff. A matching open row
-- from the last 5 seconds is dropped so the duplicate is not stored again.
CREATE OR REPLACE FUNCTION public.mandy_handoffs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  NEW.dedupe_key := public.mandy_handoff_fingerprint(NEW.summary);
  IF NEW.webhook_status IS NULL OR btrim(NEW.webhook_status) = '' THEN
    NEW.webhook_status := 'pending';
  END IF;
  IF NEW.dedupe_key IS NULL OR NEW.dedupe_key = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(public.mandy_handoff_lock_key(NEW.user_id, NEW.company_id, NEW.dedupe_key));
  SELECT h.id INTO v_existing
  FROM public.mandy_handoffs h
  WHERE h.user_id IS NOT DISTINCT FROM NEW.user_id
    AND h.company_id IS NOT DISTINCT FROM NEW.company_id
    AND h.dedupe_key = NEW.dedupe_key
    AND h.created_at > now() - interval '5 seconds'
  ORDER BY h.created_at DESC
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mandy_handoffs_before_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mandy_handoffs_dedupe_bi ON public.mandy_handoffs;
CREATE TRIGGER mandy_handoffs_dedupe_bi
  BEFORE INSERT ON public.mandy_handoffs
  FOR EACH ROW
  EXECUTE FUNCTION public.mandy_handoffs_before_insert();

-- Service role only. Returns the existing id when the same person repeats the
-- same request within 5 seconds, so the edge function does not post twice.
CREATE OR REPLACE FUNCTION public.save_mandy_handoff(
  p_company_id uuid,
  p_user_id uuid,
  p_role text,
  p_page text,
  p_entity_ids jsonb,
  p_transcript text,
  p_summary text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary text := left(btrim(coalesce(p_summary, '')), 2000);
  v_fp text;
  v_id uuid;
  v_created timestamptz;
BEGIN
  IF v_summary = '' THEN
    RAISE EXCEPTION 'summary required';
  END IF;
  IF p_entity_ids IS NULL OR jsonb_typeof(p_entity_ids) <> 'object' THEN
    p_entity_ids := '{}'::jsonb;
  END IF;
  v_fp := public.mandy_handoff_fingerprint(v_summary);
  IF v_fp <> '' THEN
    PERFORM pg_advisory_xact_lock(public.mandy_handoff_lock_key(p_user_id, p_company_id, v_fp));
    SELECT h.id, h.created_at INTO v_id, v_created
    FROM public.mandy_handoffs h
    WHERE h.user_id IS NOT DISTINCT FROM p_user_id
      AND h.company_id IS NOT DISTINCT FROM p_company_id
      AND h.dedupe_key = v_fp
      AND h.created_at > now() - interval '5 seconds'
    ORDER BY h.created_at DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'deduped', true, 'created_at', v_created);
    END IF;
  END IF;

  INSERT INTO public.mandy_handoffs (
    company_id, user_id, role, page, entity_ids, transcript, summary, status, dedupe_key, webhook_status, webhook_attempts
  ) VALUES (
    p_company_id,
    p_user_id,
    left(p_role, 40),
    left(p_page, 300),
    p_entity_ids,
    left(p_transcript, 4000),
    v_summary,
    'open',
    v_fp,
    'pending',
    0
  )
  RETURNING id, created_at INTO v_id, v_created;

  IF v_id IS NULL THEN
    SELECT h.id, h.created_at INTO v_id, v_created
    FROM public.mandy_handoffs h
    WHERE h.user_id IS NOT DISTINCT FROM p_user_id
      AND h.company_id IS NOT DISTINCT FROM p_company_id
      AND h.dedupe_key = v_fp
      AND h.created_at > now() - interval '5 seconds'
    ORDER BY h.created_at DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_id, 'deduped', true, 'created_at', v_created);
    END IF;
    RAISE EXCEPTION 'could not store hand-off';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'deduped', false, 'created_at', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.save_mandy_handoff(uuid, uuid, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_mandy_handoff(uuid, uuid, text, text, jsonb, text, text) TO service_role;
