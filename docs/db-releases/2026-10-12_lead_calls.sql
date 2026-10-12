-- Lead offer phone calls (12 Oct 2026). Simple Twilio keypad version. Ships OFF (enabled=false, test_only=true).
-- Re-uses the existing offer rules: _tech_offer_fit (tech_offers) and _rep_lead_fit (rep_offerable_leads), _same_client_booked.
-- Calls never hide/alter a lead; only a real accept changes it (same as accepting in the app).
BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lead_contact_pref text NOT NULL DEFAULT 'app';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_lead_contact_pref_chk CHECK (lead_contact_pref IN ('app','whatsapp','call'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.app_webhook_config ADD COLUMN IF NOT EXISTS lead_call_token uuid DEFAULT gen_random_uuid();
UPDATE public.app_webhook_config SET lead_call_token = gen_random_uuid() WHERE lead_call_token IS NULL;

CREATE TABLE IF NOT EXISTS public.lead_call_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,              -- master switch
  test_only boolean NOT NULL DEFAULT true,             -- only people in allowlist are phoned
  allowlist uuid[] NOT NULL DEFAULT '{}',
  mode text NOT NULL DEFAULT 'sequential' CHECK (mode IN ('single','sequential','simultaneous')),
  max_people int NOT NULL DEFAULT 5 CHECK (max_people BETWEEN 1 AND 20),
  ring_seconds int NOT NULL DEFAULT 25 CHECK (ring_seconds BETWEEN 10 AND 60),
  call_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',      -- ISO dow, 1=Mon
  call_start time NOT NULL DEFAULT '08:00',
  call_end time NOT NULL DEFAULT '17:00',
  from_number text,                                    -- Twilio voice number (E.164). Empty = never dial.
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_call_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_call_settings_admin_read ON public.lead_call_settings;
CREATE POLICY lead_call_settings_admin_read ON public.lead_call_settings FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) AND public.is_ops_user(auth.uid()) AND NOT public.is_sales_rep(auth.uid()));

CREATE TABLE IF NOT EXISTS public.lead_call_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL, lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  profile_id uuid, person_name text, phone text, position int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'queued',  -- queued|calling|accepted|passed|no_answer|failed|taken|accept_failed|skipped|dry_run|not_called
  reason text, digits text, twilio_call_sid text, dry_run boolean NOT NULL DEFAULT false,
  slot_date date, slot_start time, minutes int, km numeric,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_call_attempts_lead_idx ON public.lead_call_attempts(lead_id, created_at);
CREATE INDEX IF NOT EXISTS lead_call_attempts_sid_idx ON public.lead_call_attempts(twilio_call_sid);
ALTER TABLE public.lead_call_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_call_attempts_admin_read ON public.lead_call_attempts;
CREATE POLICY lead_call_attempts_admin_read ON public.lead_call_attempts FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) AND public.is_ops_user(auth.uid()) AND NOT public.is_sales_rep(auth.uid()));

-- Who may be offered this lead (existing rules), nearest first. Service role only.
CREATE OR REPLACE FUNCTION public.lead_call_candidates(p_lead uuid)
RETURNS TABLE(profile_id uuid, full_name text, phone text, pref text, role text, km numeric, slot_date date, slot_start time, minutes int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l public.leads; v_sales boolean;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL OR l.assigned_agent_id IS NOT NULL OR l.deleted_at IS NOT NULL OR l.merged_into_id IS NOT NULL
     OR public._same_client_booked(l.id) THEN RETURN; END IF;
  -- Work type unsure (primary_intent NULL) -> no automatic calls; admin picks first.
  IF l.primary_intent IS NULL THEN RETURN; END IF;
  v_sales := l.primary_intent::text = 'sales';
  IF v_sales THEN
    IF l.status <> 'pending' THEN RETURN; END IF;
    RETURN QUERY SELECT p.id, p.full_name, p.phone, p.lead_contact_pref, 'sales'::text, f.km,
        COALESCE(l.scheduled_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date), COALESCE(l.scheduled_time, f.best_start),
        COALESCE(l.estimated_duration_minutes, 60)
      FROM public.profiles p CROSS JOIN LATERAL public._rep_lead_fit(p.id, l.id) f
     WHERE p.company_id = l.company_id AND p.archived_at IS NULL AND public.is_sales_rep(p.id) AND f.fits
     ORDER BY f.km NULLS LAST;
  ELSE
    IF l.status NOT IN ('pending','open','released') THEN RETURN; END IF;
    RETURN QUERY SELECT p.id, p.full_name, p.phone, p.lead_contact_pref, 'technician'::text, f.km, f.slot_date, f.slot_start, f.minutes
      FROM public.profiles p CROSS JOIN LATERAL public._tech_offer_fit(p.id, l.id) f
     WHERE p.company_id = l.company_id AND p.archived_at IS NULL AND public.is_field_tech_only(p.id) AND f.fits
     ORDER BY f.km NULLS LAST;
  END IF;
END $f$;

-- Keypad "1": atomic claim for the person on this attempt. First wins (row lock on the lead).
CREATE OR REPLACE FUNCTION public.lead_call_accept(p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE a public.lead_call_attempts; l public.leads; v_res jsonb; f record; v_m int; v_start timestamptz;
BEGIN
  SELECT * INTO a FROM public.lead_call_attempts WHERE id = p_attempt FOR UPDATE;
  IF a.id IS NULL OR a.profile_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown attempt'); END IF;
  SELECT * INTO l FROM public.leads WHERE id = a.lead_id FOR UPDATE;
  IF l.assigned_agent_id IS NOT NULL OR l.deleted_at IS NOT NULL OR l.merged_into_id IS NOT NULL
     OR l.status NOT IN ('pending','open','released') THEN
    UPDATE public.lead_call_attempts SET status = 'taken', digits = '1', reason = 'already taken', updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END IF;
  -- act as that person so the existing guards (fit/clash, same-client) run with auth.uid() = them
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a.profile_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.profile_id::text, true);
  BEGIN
    IF public.is_field_tech_only(a.profile_id) THEN
      v_res := public.tech_accept_lead(l.id, a.slot_date, a.slot_start, a.minutes, NULL, NULL, NULL, NULL, NULL, NULL);
    ELSIF public.is_sales_rep(a.profile_id) THEN
      SELECT * INTO f FROM public._rep_lead_fit(a.profile_id, l.id);
      IF NOT COALESCE(f.fits, false) THEN RAISE EXCEPTION 'No longer fits your day: %', f.reason; END IF;
      v_m := COALESCE(l.estimated_duration_minutes, a.minutes, 60);
      v_start := (COALESCE(l.scheduled_date, a.slot_date) + COALESCE(l.scheduled_time, a.slot_start, f.best_start)) AT TIME ZONE 'Africa/Johannesburg';
      UPDATE public.leads SET status = 'accepted', assigned_agent_id = a.profile_id,
        scheduled_date = COALESCE(scheduled_date, a.slot_date), scheduled_time = COALESCE(scheduled_time, a.slot_start, f.best_start),
        estimated_duration_minutes = v_m, estimated_end_time = v_start + make_interval(mins => v_m), accepted_at = now()
       WHERE id = l.id AND assigned_agent_id IS NULL;
      v_res := jsonb_build_object('lead_id', l.id);
    ELSE RAISE EXCEPTION 'Not a technician or sales rep';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.lead_call_attempts SET status = 'accept_failed', digits = '1', reason = left(SQLERRM, 300), updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
  END;
  UPDATE public.lead_call_attempts SET status = 'accepted', digits = '1', updated_at = now() WHERE id = a.id;
  UPDATE public.lead_call_attempts SET status = 'taken', reason = 'accepted by ' || COALESCE(a.person_name, 'someone'), updated_at = now()
   WHERE lead_id = a.lead_id AND id <> a.id AND status IN ('queued','calling');
  RETURN jsonb_build_object('ok', true, 'result', v_res);
END $f$;

-- Admin card chip: latest call state per lead (admin/office only; same gate as lead_duplicate_flags). Never filters leads.
CREATE OR REPLACE FUNCTION public.lead_call_statuses()
RETURNS TABLE(lead_id uuid, state text, person text, at timestamptz, n_passed int, n_no_answer int, n_called int, dry_run boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_ops_user(v_uid) OR public.is_sales_rep(v_uid) THEN RETURN; END IF;
  RETURN QUERY
  SELECT a.lead_id,
    CASE WHEN bool_or(a.status = 'accepted') THEN 'accepted'
         WHEN bool_or(a.status = 'calling') THEN 'calling'
         WHEN bool_or(a.status = 'queued') THEN 'queued'
         WHEN bool_or(a.status = 'dry_run') THEN 'dry_run'
         WHEN bool_or(a.status = 'not_called') AND count(*) FILTER (WHERE a.profile_id IS NOT NULL) = 0 THEN 'not_called'
         ELSE 'ended' END,
    COALESCE(max(a.person_name) FILTER (WHERE a.status = 'accepted'), max(a.person_name) FILTER (WHERE a.status = 'calling'),
             max(a.reason) FILTER (WHERE a.status = 'not_called')),
    COALESCE(max(a.updated_at) FILTER (WHERE a.status = 'accepted'), max(a.updated_at)),
    (count(*) FILTER (WHERE a.status = 'passed'))::int, (count(*) FILTER (WHERE a.status IN ('no_answer','failed')))::int,
    (count(*) FILTER (WHERE a.profile_id IS NOT NULL))::int, bool_and(a.dry_run)
  FROM public.lead_call_attempts a
  WHERE a.company_id = public.get_user_company_id(v_uid) AND a.created_at > now() - interval '30 days'
  GROUP BY a.lead_id;
END $f$;

-- New lead -> ask the edge function to phone people. No-op unless the company's master switch is on.
CREATE OR REPLACE FUNCTION public._lead_call_kickoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$
DECLARE v_token uuid;
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL OR NEW.latitude IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_call_settings s WHERE s.company_id = NEW.company_id AND s.enabled) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.lead_call_attempts a WHERE a.lead_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT lead_call_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/lead-offer-call',
    headers := jsonb_build_object('Content-Type','application/json','x-lead-call-token', v_token::text),
    body := jsonb_build_object('action','start','lead_id', NEW.id), timeout_milliseconds := 30000);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;  -- never block a lead insert
END $f$;
DROP TRIGGER IF EXISTS trg_lead_call_kickoff ON public.leads;
CREATE TRIGGER trg_lead_call_kickoff AFTER INSERT OR UPDATE OF latitude ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public._lead_call_kickoff();

REVOKE EXECUTE ON FUNCTION public.lead_call_candidates(uuid), public.lead_call_accept(uuid), public._lead_call_kickoff() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_call_candidates(uuid), public.lead_call_accept(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.lead_call_statuses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_call_statuses() TO authenticated;

-- Safe defaults: OFF, test-only, allowlist = Johan (0800-BE-COOL profile), no from_number.
INSERT INTO public.lead_call_settings (company_id, enabled, test_only, allowlist)
VALUES ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e', false, true, ARRAY['1e795a9b-f8bd-4af5-8f28-5e0426101daa'::uuid])
ON CONFLICT (company_id) DO NOTHING;
COMMIT;
