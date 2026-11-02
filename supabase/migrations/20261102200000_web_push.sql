-- Web push (opt-in). Not applied live. Each user sees only their own subscriptions (POPIA).
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subs_own_select ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY push_subs_own_insert ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY push_subs_own_update ON public.push_subscriptions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY push_subs_own_delete ON public.push_subscriptions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Outbox filled by the PUSH HOOK; drained by the send-push edge function. No client access.
CREATE TABLE IF NOT EXISTS public.push_outbox (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,   -- built by fl_push_text: never a client name or personal detail
  body text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS push_outbox_pending ON public.push_outbox(created_at) WHERE sent_at IS NULL;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;

-- Push text (Johan 19:16: no client names): fixed title + job type + rough area (suburb/town only) + 'tap to view'.
CREATE OR REPLACE FUNCTION public.fl_push_area(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(public.fl_rough_area(p), '^.*,', '')), '');
$$;
CREATE OR REPLACE FUNCTION public.fl_push_text(p_type text, p_request uuid)
RETURNS TABLE(title text, body text, url text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_type WHEN 'request_offer' THEN 'New sale offer'
                     WHEN 'request_offer_unclaimed' THEN 'New sale not accepted yet'
                     ELSE 'Request needs attention' END,
         concat_ws(' · ',
           CASE r.type::text WHEN 'new_sale' THEN 'New sale' WHEN 'service' THEN 'Service' WHEN 'move' THEN 'Move'
                             WHEN 'admin' THEN 'Admin task' ELSE 'Request' END,
           public.fl_push_area(r.area), 'Tap to view'),
         CASE WHEN p_type = 'request_offer' THEN '/admin' ELSE '/admin/requests' END
  FROM (SELECT 1) one LEFT JOIN public.requests r ON r.id = p_request;
$$;
REVOKE ALL ON FUNCTION public.fl_push_text(text, uuid) FROM PUBLIC, anon, authenticated;

-- PUSH HOOK wired: push-flagged alerts (offers, 10-min alert, request alerts) enqueue only for opted-in users.
CREATE OR REPLACE FUNCTION public.fl_alert_deliver(p_user uuid, p_type text, p_title text, p_body text, p_related uuid, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications(user_id, type, title, body, related_id, metadata, read)
  VALUES (p_user, p_type, p_title, p_body, p_related, coalesce(p_meta, '{}'::jsonb), false)
  RETURNING id INTO v_id;
  IF coalesce((p_meta->>'push')::boolean, false)
     AND EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p_user) THEN
    INSERT INTO public.push_outbox(notification_id, user_id, title, body, url)
    SELECT v_id, p_user, t.title, t.body, t.url FROM public.fl_push_text(p_type, p_related) t;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fl_alert_deliver(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- Server-only secret lookup for send-push (VAPID private key + cron key live in Supabase Vault). service_role only.
CREATE OR REPLACE FUNCTION public.fl_push_secret(p_name text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name = p_name AND p_name IN ('vapid_private_key', 'vapid_public_key', 'vapid_subject', 'push_cron_key');
$$;
REVOKE ALL ON FUNCTION public.fl_push_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_push_secret(text) TO service_role;
