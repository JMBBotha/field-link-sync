-- Short calls and hang-ups are an admin follow-up, not a lead and not a customer.
-- Closing a lead (dismiss, archive, resolve, accept) marks its New Lead,
-- Call Logged, and hot-lead alerts read for every recipient.
-- Does not update or delete existing leads or customers. No backfill.
-- Rollback: supabase/manual/20261116220000_hangup_admin_followup_rollback.sql

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archive_reason text;

COMMENT ON COLUMN public.company_settings.sales_stage_limits IS
  'Heartbeat stall limits; null = app defaults {leadRepMin:5,leadTeamMin:15,leadOwnerMin:30,contactedDays:1,contactedAdminDays:2,sentDays:2,viewedDays:3,viewedAdminDays:7,acceptedDays:2,acceptedAdminDays:4,depositDays:1,doneDays:7,hangupSeconds:15}. hangupSeconds is the short-call length: under that, with no name and no details, the call is an admin follow-up and not a hot lead.';

-- ---------------------------------------------------------------------------
-- Admin follow-up for a logged call. One row per provider call. No customer insert.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.call_admin_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  call_id uuid,
  provider_call_id text,
  customer_id uuid,
  phone text NOT NULL,
  called_at timestamptz NOT NULL,
  duration_seconds integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'converted')),
  lead_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  converted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS call_admin_followups_provider_uq
  ON public.call_admin_followups (company_id, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_admin_followups_open_idx
  ON public.call_admin_followups (company_id, created_at DESC)
  WHERE status = 'open';

ALTER TABLE public.call_admin_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_admin_followups_admin_read ON public.call_admin_followups;
CREATE POLICY call_admin_followups_admin_read ON public.call_admin_followups
  FOR SELECT TO authenticated
  USING (
    company_id = public.caller_company_id()
    AND public.has_role(auth.uid(), 'admin')
  );

REVOKE ALL ON public.call_admin_followups FROM PUBLIC, anon;
GRANT SELECT ON public.call_admin_followups TO authenticated;
GRANT ALL ON public.call_admin_followups TO service_role;

CREATE OR REPLACE FUNCTION public.caller_name_missing(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(btrim(p_name), '') = ''
      OR lower(btrim(p_name)) IN ('unknown', 'unknown caller', 'caller', 'anonymous', 'n/a', 'na', 'none', 'no name');
$$;

CREATE OR REPLACE FUNCTION public.address_is_empty(p_address text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(btrim(p_address), '') = ''
      OR lower(btrim(p_address)) LIKE 'address pending%';
$$;

-- Match an existing client in this company. Never inserts a customer.
CREATE OR REPLACE FUNCTION public.match_customer_by_phone(p_company uuid, p_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id
    FROM public.customers c
   WHERE c.company_id = p_company
     AND length(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9)) = 9
     AND right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9)
         = right(regexp_replace(p_phone, '\D', '', 'g'), 9)
   ORDER BY c.created_at DESC NULLS LAST
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.match_customer_by_phone(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_customer_by_phone(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.log_call_admin_followup(
  p_company uuid,
  p_phone text,
  p_called_at timestamptz,
  p_duration integer,
  p_call_id uuid DEFAULT NULL,
  p_provider_call_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_customer uuid;
  v_phone text := btrim(coalesce(p_phone, ''));
  v_when text;
  v_body text;
  v_inserted boolean := false;
BEGIN
  IF p_company IS NULL OR v_phone = '' THEN
    RETURN NULL;
  END IF;
  v_customer := public.match_customer_by_phone(p_company, v_phone);

  IF nullif(btrim(coalesce(p_provider_call_id, '')), '') IS NOT NULL THEN
    SELECT id INTO v_id
      FROM public.call_admin_followups
     WHERE company_id = p_company AND provider_call_id = p_provider_call_id;
  END IF;

  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO public.call_admin_followups (
        company_id, call_id, provider_call_id, customer_id, phone, called_at, duration_seconds
      ) VALUES (
        p_company, p_call_id, nullif(btrim(coalesce(p_provider_call_id, '')), ''),
        v_customer, v_phone, coalesce(p_called_at, now()), GREATEST(coalesce(p_duration, 0), 0)
      )
      RETURNING id INTO v_id;
      v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_id
        FROM public.call_admin_followups
       WHERE company_id = p_company AND provider_call_id = p_provider_call_id;
      v_inserted := false;
    END;
  ELSIF p_call_id IS NOT NULL THEN
    UPDATE public.call_admin_followups
       SET call_id = coalesce(call_id, p_call_id),
           customer_id = coalesce(customer_id, v_customer)
     WHERE id = v_id;
  END IF;

  IF NOT v_inserted THEN
    RETURN v_id;
  END IF;

  v_when := to_char(coalesce(p_called_at, now()) AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon HH24:MI');
  v_body := v_phone || ' · ' || v_when || ' · ' || GREATEST(coalesce(p_duration, 0), 0)::text
    || 's. Open the call log.';

  INSERT INTO public.notifications (user_id, type, title, body, read, related_id, metadata)
  SELECT a,
         'call_admin_followup',
         'Short call / hang-up',
         v_body,
         false,
         v_id,
         jsonb_build_object(
           'followup_id', v_id,
           'call_id', p_call_id,
           'phone', v_phone,
           'called_at', coalesce(p_called_at, now()),
           'duration_seconds', GREATEST(coalesce(p_duration, 0), 0),
           'customer_id', v_customer,
           'href', CASE
             WHEN p_call_id IS NULL THEN '/admin/calls'
             ELSE '/admin/calls?call=' || p_call_id::text
           END
         )
    FROM unnest(public._hb_admins(p_company)) AS a;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_call_admin_followup(uuid, text, timestamptz, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_call_admin_followup(uuid, text, timestamptz, integer, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._followup_admin_ok(p_company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'admin')
     AND p_company = public.caller_company_id();
$$;

REVOKE ALL ON FUNCTION public._followup_admin_ok(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_call_admin_followup(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.call_admin_followups;
BEGIN
  SELECT * INTO v FROM public.call_admin_followups WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._followup_admin_ok(v.company_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v.status = 'open' THEN
    UPDATE public.call_admin_followups
       SET status = 'dismissed', dismissed_at = now()
     WHERE id = v.id;
  END IF;
  UPDATE public.notifications
     SET read = true
   WHERE read IS DISTINCT FROM true
     AND type = 'call_admin_followup'
     AND related_id = v.id;
  RETURN jsonb_build_object('id', v.id, 'status', CASE WHEN v.status = 'converted' THEN 'converted' ELSE 'dismissed' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_call_admin_followup(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.call_admin_followups;
  v_name text;
  v_lead uuid;
BEGIN
  SELECT * INTO v FROM public.call_admin_followups WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._followup_admin_ok(v.company_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v.status = 'dismissed' THEN
    RAISE EXCEPTION 'This follow-up was dismissed';
  END IF;
  IF v.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v.id, 'lead_id', v.lead_id, 'status', 'converted');
  END IF;

  IF v.customer_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(c.name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
      INTO v_name
      FROM public.customers c
     WHERE c.id = v.customer_id AND c.company_id = v.company_id;
  END IF;
  IF public.caller_name_missing(v_name) THEN
    v_name := v.phone;
  END IF;

  INSERT INTO public.leads (
    customer_name, customer_phone, phone, customer_id, company_id,
    status, source, service_type, notes, customer_address, latitude, longitude
  ) VALUES (
    v_name, v.phone, v.phone, v.customer_id, v.company_id,
    'pending', 'vapi_call', 'General Inquiry',
    'Made from a short-call follow-up. ' || v.phone || ' · '
      || to_char(v.called_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon HH24:MI')
      || ' · ' || v.duration_seconds::text || 's',
    '', 0, 0
  )
  RETURNING id INTO v_lead;

  UPDATE public.call_admin_followups
     SET status = 'converted', lead_id = v_lead, converted_at = now()
   WHERE id = v.id;

  IF v.call_id IS NOT NULL AND to_regclass('public.vapi_calls') IS NOT NULL THEN
    UPDATE public.vapi_calls SET lead_id = v_lead WHERE id = v.call_id AND lead_id IS NULL;
  END IF;

  UPDATE public.notifications
     SET read = true
   WHERE read IS DISTINCT FROM true
     AND type = 'call_admin_followup'
     AND related_id = v.id;

  RETURN jsonb_build_object('id', v.id, 'lead_id', v_lead, 'status', 'converted');
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_call_admin_followup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_call_admin_followup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_call_admin_followup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_call_admin_followup(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Hot-lead escalation skips a bare hang-up and a call the report scored cold.
-- The lead row is left as it is.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lead_skips_hot_escalation(p_lead uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  l public.leads%ROWTYPE;
  v_threshold numeric;
  v_seconds integer;
  v_level text;
  v_score integer;
  v_next text;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF l.archived_at IS NOT NULL OR l.dismissed_at IS NOT NULL OR l.closed_at IS NOT NULL THEN
    RETURN true;
  END IF;

  IF to_regclass('public.call_reports') IS NOT NULL THEN
    SELECT cr.lead_level, cr.score, cr.next_action
      INTO v_level, v_score, v_next
      FROM public.call_reports cr
     WHERE cr.lead_id = p_lead AND cr.status = 'done'
     ORDER BY cr.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      IF v_level = 'cold' OR v_score IS NOT NULL AND v_score <= 1
         OR coalesce(v_next, '') ~* 'no follow[- ]?up' THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  v_threshold := public._hb_limit(l.company_id, 'hangupSeconds', 15);
  IF public.caller_name_missing(l.customer_name)
     AND public.address_is_empty(l.customer_address)
     AND to_regclass('public.vapi_calls') IS NOT NULL THEN
    SELECT c.duration_seconds INTO v_seconds
      FROM public.vapi_calls c
     WHERE c.lead_id = p_lead
     ORDER BY c.created_at DESC
     LIMIT 1;
    IF FOUND AND v_seconds IS NOT NULL AND v_seconds < v_threshold THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.lead_skips_hot_escalation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_skips_hot_escalation(uuid) TO service_role;

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.process_sales_escalations()'::regprocedure);
  IF position('lead_skips_hot_escalation' IN d) > 0 THEN
    RETURN;
  END IF;
  -- The hot-lead loop is the one limited to leads from the last 3 days. Keep its original casing.
  IF d !~* 'created_at > v_now - interval ''3 days''[[:space:]]+loop' THEN
    RAISE EXCEPTION 'process_sales_escalations() no longer has the hot-lead loop this migration patches';
  END IF;
  d := regexp_replace(
    d,
    '(and[[:space:]]+l\.created_at > v_now - interval ''3 days'')[[:space:]]+loop',
    '\1 and not public.lead_skips_hot_escalation(l.id) loop',
    'i'
  );
  EXECUTE d;
END $$;

-- ---------------------------------------------------------------------------
-- Closing a lead marks New Lead, Call Logged, and hot-lead alerts read.
-- Idempotent: a second close, or an update that does not close, changes nothing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_lead_alerts_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (NEW.dismissed_at IS NOT NULL AND OLD.dismissed_at IS NULL)
    OR (NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL)
    OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL)
    OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('accepted', 'resolved_before_visit', 'completed', 'lost', 'cancelled'))
    OR (NEW.lead_status::text IS DISTINCT FROM OLD.lead_status::text
        AND NEW.lead_status::text IN ('resolved_before_visit', 'lost', 'completed', 'cancelled', 'accepted'))
  ) THEN
    RETURN NEW;
  END IF;

  UPDATE public.notifications n
     SET read = true
   WHERE n.read IS DISTINCT FROM true
     AND (
       (n.type IN ('new_lead', 'lead_assigned') AND n.related_id = NEW.id)
       OR (n.type = 'sales_nudge' AND n.related_id = NEW.id AND coalesce(n.metadata->>'entity', 'lead') = 'lead')
       OR (n.type = 'call_logged' AND (n.related_id = NEW.id OR n.metadata->>'lead_id' = NEW.id::text))
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_mark_alerts_read ON public.leads;
CREATE TRIGGER leads_mark_alerts_read
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_lead_alerts_read();
