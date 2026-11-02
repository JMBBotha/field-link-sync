-- B) in-app request alerts + C) 5/2/10 New sale offer (plan: alerts-offer-plan.md, Johan 2 Nov 18:47).
-- In-app only. Push is NOT built here: fl_alert_deliver() is the single delivery hook where a push channel plugs in later.
-- C ships OFF (lead_offer_settings.enabled default false). Cron jobs live in supabase/manual/bc_cron.sql (applied by hand).

CREATE OR REPLACE FUNCTION public.fl_alert_deliver(p_user uuid, p_type text, p_title text, p_body text, p_related uuid, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications(user_id, type, title, body, related_id, metadata, read)
  VALUES (p_user, p_type, p_title, p_body, p_related, coalesce(p_meta, '{}'::jsonb), false)
  RETURNING id INTO v_id;
  -- PUSH HOOK: a push channel enqueues here (e.g. INSERT INTO push_outbox(notification_id) VALUES (v_id)).
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fl_alert_deliver(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- Admin audience = company admins + owners (Johan 18:47).
CREATE OR REPLACE FUNCTION public.fl_company_admin_ids(p_company uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT user_id FROM public.company_members WHERE company_id = p_company AND (role = 'admin' OR is_owner IS TRUE);
$$;

-- ---------- B ----------
CREATE TABLE IF NOT EXISTS public.request_alert_settings (
  company_id uuid PRIMARY KEY,
  contact_limit_wmin int NOT NULL DEFAULT 120 CHECK (contact_limit_wmin BETWEEN 15 AND 5400),
  unscheduled_limit_wmin int NOT NULL DEFAULT 1440 CHECK (unscheduled_limit_wmin BETWEEN 60 AND 10800),
  task_overdue_wdays int NOT NULL DEFAULT 1 CHECK (task_overdue_wdays BETWEEN 0 AND 10),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.request_alert_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ras_read ON public.request_alert_settings FOR SELECT TO authenticated USING (public.is_company_member(auth.uid(), company_id));
CREATE POLICY ras_write ON public.request_alert_settings FOR ALL TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id));

CREATE TABLE IF NOT EXISTS public.request_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('not_contacted','service_unscheduled','move_unscheduled','task_overdue')),
  recipient_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (request_id, kind, recipient_id)
);
ALTER TABLE public.request_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ra_read ON public.request_alerts FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() OR public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id));

-- Recipients: assignee + admins/owners; Move requests also the client's own rep (Johan 18:47). Company members only, never clients.
CREATE OR REPLACE FUNCTION public.fl_request_alert_recipients(r public.requests)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT x.u FROM (
    SELECT r.assigned_to AS u
    UNION ALL SELECT public.fl_company_admin_ids(r.company_id)
    UNION ALL SELECT coalesce(c.owner_rep_id, c.assigned_rep_id) FROM public.customers c WHERE r.type::text = 'move' AND c.id = r.customer_id
  ) x
  WHERE x.u IS NOT NULL AND EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = x.u AND m.company_id = r.company_id);
$$;

-- p_now = fake clock for tests.
CREATE OR REPLACE FUNCTION public.fl_request_alerts_tick(p_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.requests; s record; v_kind text; v_uid uuid; v_new int := 0; v_title text; v_users uuid[]; v_hit boolean;
BEGIN
  FOR q IN SELECT r.* FROM public.requests r LEFT JOIN public.request_alert_settings x ON x.company_id = r.company_id
           WHERE r.status = 'open' AND r.company_id IS NOT NULL AND coalesce(x.enabled, true) AND r.created_at <= p_now LOOP
    SELECT coalesce(max(contact_limit_wmin),120) AS c, coalesce(max(unscheduled_limit_wmin),1440) AS u, coalesce(max(task_overdue_wdays),1) AS t
      INTO s FROM public.request_alert_settings WHERE company_id = q.company_id;
    FOREACH v_kind IN ARRAY ARRAY['not_contacted','service_unscheduled','move_unscheduled','task_overdue'] LOOP
      v_hit := CASE v_kind
        WHEN 'not_contacted' THEN NOT public.fl_request_contacted(q) AND public.fl_working_minutes(q.created_at, p_now) > s.c
        WHEN 'service_unscheduled' THEN q.type::text = 'service' AND q.scheduled_for IS NULL AND public.fl_working_minutes(q.created_at, p_now) > s.u
        WHEN 'move_unscheduled' THEN q.type::text = 'move' AND q.scheduled_for IS NULL AND public.fl_working_minutes(q.created_at, p_now) > s.u
        ELSE q.type::text = 'admin' AND q.task_due_at IS NOT NULL AND public.fl_working_minutes(q.task_due_at, p_now) > s.t * 540 END;
      CONTINUE WHEN NOT coalesce(v_hit, false);
      v_users := '{}';
      FOR v_uid IN SELECT public.fl_request_alert_recipients(q) LOOP
        INSERT INTO public.request_alerts(company_id, request_id, kind, recipient_id, created_at)
        VALUES (q.company_id, q.id, v_kind, v_uid, p_now) ON CONFLICT DO NOTHING;
        IF FOUND THEN
          v_new := v_new + 1; v_users := v_users || v_uid;
          v_title := CASE v_kind WHEN 'not_contacted' THEN 'Request not contacted yet' WHEN 'service_unscheduled' THEN 'Service request has no date'
                     WHEN 'move_unscheduled' THEN 'Move request has no date' ELSE 'Admin task overdue' END;
          PERFORM public.fl_alert_deliver(v_uid, 'request_alert', v_title, coalesce(nullif(q.area,''), q.summary, 'Open request'), q.id,
            jsonb_build_object('kind', v_kind, 'request_id', q.id, 'request_type', q.type::text, 'push', true));
        END IF;
      END LOOP;
      IF coalesce(array_length(v_users,1),0) > 0 THEN
        INSERT INTO public.audit_log(table_name, record_id, action, new_data, company_id, created_at)
        VALUES ('requests', q.id, 'request_alert', jsonb_build_object('kind', v_kind, 'recipients', to_jsonb(v_users)), q.company_id, p_now);
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.fl_request_alerts_tick(timestamptz) FROM PUBLIC;

-- ---------- C ----------
CREATE TABLE IF NOT EXISTS public.lead_offer_settings (
  company_id uuid PRIMARY KEY,
  first_wave int NOT NULL DEFAULT 3 CHECK (first_wave BETWEEN 3 AND 5),
  first_window_min int NOT NULL DEFAULT 5 CHECK (first_window_min BETWEEN 1 AND 60),
  widen_every_min int NOT NULL DEFAULT 2 CHECK (widen_every_min BETWEEN 1 AND 30),
  widen_by int NOT NULL DEFAULT 2 CHECK (widen_by BETWEEN 1 AND 10),
  escalate_after_min int NOT NULL DEFAULT 10 CHECK (escalate_after_min BETWEEN 2 AND 120),
  escalate_to uuid,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_offer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY los_read ON public.lead_offer_settings FOR SELECT TO authenticated USING (public.is_company_member(auth.uid(), company_id));
CREATE POLICY los_write ON public.lead_offer_settings FOR ALL TO authenticated
  USING (public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id))
  WITH CHECK (public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id));
-- Only requests created after switching on get offered (no backlog blast).
CREATE OR REPLACE FUNCTION public.fl_los_enabled_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled) THEN NEW.enabled_at := coalesce(NEW.enabled_at, now()); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_los_enabled_at BEFORE INSERT OR UPDATE ON public.lead_offer_settings FOR EACH ROW EXECUTE FUNCTION public.fl_los_enabled_at();

CREATE TABLE IF NOT EXISTS public.request_offer_runs (
  request_id uuid PRIMARY KEY REFERENCES public.requests(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  waves int NOT NULL DEFAULT 0,
  escalated_at timestamptz,
  won_by uuid, won_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.request_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  rep_id uuid NOT NULL,
  wave int NOT NULL,
  rank int NOT NULL,
  distance_km numeric,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','passed','withdrawn')),
  offered_at timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (request_id, rep_id)
);
ALTER TABLE public.request_offer_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_offers ENABLE ROW LEVEL SECURITY;
-- Reps never read these directly (masking lives in my_request_offers); admins/owners can audit.
CREATE POLICY ror_admin ON public.request_offer_runs FOR SELECT TO authenticated USING (public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id));
CREATE POLICY ro_admin ON public.request_offers FOR SELECT TO authenticated USING (public.is_company_admin(auth.uid(), company_id) OR public.is_company_owner(auth.uid(), company_id));

CREATE OR REPLACE FUNCTION public.fl_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lat1 IS NULL OR lat2 IS NULL OR lng1 IS NULL OR lng2 IS NULL THEN NULL ELSE
    6371 * 2 * asin(sqrt(power(sin(radians(lat2-lat1)/2),2) + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2))) END;
$$;

-- Rough area only: text before an em dash, last " / " part, digits stripped (no house numbers).
CREATE OR REPLACE FUNCTION public.fl_rough_area(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(split_part(coalesce(p,''), '—', 1), '^.*/', ''), '[0-9]+', '', 'g')), '');
$$;

-- Ranking (Johan 18:47): available now first, then distance, then skills match, then workload (fewer open requests first).
CREATE OR REPLACE FUNCTION public.rank_reps_for_request(p_request uuid)
RETURNS TABLE(rep_id uuid, rank int, available boolean, distance_km numeric, skill_match boolean, workload int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (
    SELECT r.id, r.company_id, coalesce(l.latitude, c.latitude)::float8 AS lat, coalesce(l.longitude, c.longitude)::float8 AS lng, coalesce(l.job_types, '{}'::text[]) AS jt
    FROM public.requests r LEFT JOIN public.leads l ON l.id = r.lead_id LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.id = p_request
  ), reps AS (
    SELECT p.id, (coalesce(p.availability_status,'offline') = 'available') AS avail,
      round(public.fl_km(q.lat, q.lng, coalesce(al.latitude::float8, p.home_lat, p.home_base_lat::float8), coalesce(al.longitude::float8, p.home_lng, p.home_base_lng::float8))::numeric, 1) AS km,
      (coalesce(p.skills,'{}'::text[]) && q.jt) AS skill,
      (SELECT count(*)::int FROM public.requests o WHERE o.assigned_to = p.id AND o.status = 'open') AS load
    FROM q JOIN public.company_members m ON m.company_id = q.company_id
    JOIN public.profiles p ON p.id = m.user_id
    LEFT JOIN LATERAL (SELECT a.latitude, a.longitude FROM public.agent_locations a WHERE a.agent_id = p.id ORDER BY a.last_updated DESC LIMIT 1) al ON true
    WHERE p.dispatch_role = 'sales' AND p.archived_at IS NULL AND coalesce(p.dispatch_active, true)
  )
  SELECT id, (row_number() OVER (ORDER BY avail DESC, km ASC NULLS LAST, skill DESC, load ASC, id))::int, avail, km, skill, load FROM reps
  ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.rank_reps_for_request(uuid) FROM PUBLIC;

-- Mirrors src/lib/requestOffers.ts wavesDue(): wave 1 at start, wave 2 at first_window, then +1 every widen_every.
CREATE OR REPLACE FUNCTION public.fl_offer_waves_due(p_elapsed_min numeric, p_first_window int, p_every int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_elapsed_min < p_first_window THEN 1 ELSE 2 + floor((p_elapsed_min - p_first_window) / p_every)::int END;
$$;

CREATE OR REPLACE FUNCTION public.fl_offer_tick(p_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.lead_offer_settings; r public.requests; run public.request_offer_runs; v_due int; v_w int; v_take int; v_rep record; v_n int := 0; v_area text; v_esc uuid;
BEGIN
  FOR s IN SELECT * FROM public.lead_offer_settings WHERE enabled LOOP
    FOR r IN SELECT * FROM public.requests q WHERE q.company_id = s.company_id AND q.type::text = 'new_sale' AND q.status = 'open'
             AND q.assigned_to IS NULL AND q.created_at >= coalesce(s.enabled_at, p_now) AND q.created_at <= p_now LOOP
      INSERT INTO public.request_offer_runs(request_id, company_id, started_at) VALUES (r.id, r.company_id, p_now) ON CONFLICT DO NOTHING;
      SELECT * INTO run FROM public.request_offer_runs WHERE request_id = r.id FOR UPDATE;
      CONTINUE WHEN run.won_by IS NOT NULL;
      v_area := coalesce(public.fl_rough_area(r.area), 'your area');
      v_due := public.fl_offer_waves_due(extract(epoch FROM p_now - run.started_at) / 60, s.first_window_min, s.widen_every_min);
      WHILE run.waves < v_due LOOP
        v_w := run.waves + 1;
        v_take := CASE WHEN v_w = 1 THEN s.first_wave ELSE s.widen_by END;
        FOR v_rep IN SELECT k.* FROM public.rank_reps_for_request(r.id) k
                     WHERE NOT EXISTS (SELECT 1 FROM public.request_offers o WHERE o.request_id = r.id AND o.rep_id = k.rep_id)
                     ORDER BY k.rank LIMIT v_take LOOP
          INSERT INTO public.request_offers(company_id, request_id, rep_id, wave, rank, distance_km, offered_at)
          VALUES (r.company_id, r.id, v_rep.rep_id, v_w, v_rep.rank, v_rep.distance_km, p_now);
          PERFORM public.fl_alert_deliver(v_rep.rep_id, 'request_offer', 'New sale offer', 'New sale · ' || v_area, r.id,
            jsonb_build_object('request_id', r.id, 'wave', v_w, 'push', true));
          v_n := v_n + 1;
        END LOOP;
        run.waves := v_w;
      END LOOP;
      UPDATE public.request_offer_runs SET waves = run.waves WHERE request_id = r.id;
      IF run.escalated_at IS NULL AND p_now - run.started_at >= make_interval(mins => s.escalate_after_min) THEN
        FOR v_esc IN SELECT DISTINCT z.u FROM (SELECT s.escalate_to AS u UNION ALL SELECT m.user_id FROM public.company_members m
                     WHERE s.escalate_to IS NULL AND m.company_id = s.company_id AND m.is_owner) z WHERE z.u IS NOT NULL LOOP
          PERFORM public.fl_alert_deliver(v_esc, 'request_offer_unclaimed', 'New sale not accepted after ' || s.escalate_after_min || ' min',
            coalesce(r.customer_name, 'New sale') || ' · ' || v_area, r.id, jsonb_build_object('request_id', r.id, 'push', true));
        END LOOP;
        UPDATE public.request_offer_runs SET escalated_at = p_now WHERE request_id = r.id;
        INSERT INTO public.audit_log(table_name, record_id, action, new_data, company_id, created_at)
        VALUES ('requests', r.id, 'request_offer_escalated', jsonb_build_object('after_min', s.escalate_after_min, 'waves', run.waves), r.company_id, p_now);
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.fl_offer_tick(timestamptz) FROM PUBLIC;

-- Rep's own offers, masked server-side: before accept only type + rough area; winner gets details; others see Taken. Never lists other reps.
CREATE OR REPLACE FUNCTION public.my_request_offers()
RETURNS TABLE(offer_id uuid, request_id uuid, job_type text, area text, offered_at timestamptz, state text, customer_name text, phone text, address text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.request_id, 'New sale'::text, coalesce(public.fl_rough_area(r.area), 'Area shown on accept'), o.offered_at,
    CASE WHEN o.status = 'accepted' THEN 'accepted' WHEN run.won_by IS NOT NULL OR o.status = 'withdrawn' THEN 'taken' WHEN o.status = 'passed' THEN 'passed' ELSE 'open' END,
    CASE WHEN o.status = 'accepted' THEN r.customer_name END,
    CASE WHEN o.status = 'accepted' THEN r.phone END,
    CASE WHEN o.status = 'accepted' THEN r.area END
  FROM public.request_offers o JOIN public.requests r ON r.id = o.request_id LEFT JOIN public.request_offer_runs run ON run.request_id = o.request_id
  WHERE o.rep_id = auth.uid() AND o.offered_at > now() - interval '2 days'
  ORDER BY o.offered_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.accept_request_offer(p_offer uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.request_offers; run public.request_offer_runs;
BEGIN
  SELECT * INTO o FROM public.request_offers WHERE id = p_offer AND rep_id = auth.uid();
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO run FROM public.request_offer_runs WHERE request_id = o.request_id FOR UPDATE;  -- serialises racing accepts
  IF run.won_by IS NOT NULL THEN RETURN CASE WHEN run.won_by = o.rep_id THEN 'accepted' ELSE 'taken' END; END IF;
  IF o.status <> 'offered' THEN RETURN o.status; END IF;
  UPDATE public.request_offer_runs SET won_by = o.rep_id, won_at = now() WHERE request_id = o.request_id;
  UPDATE public.request_offers SET status = 'accepted', responded_at = now() WHERE id = o.id;
  UPDATE public.request_offers SET status = 'withdrawn' WHERE request_id = o.request_id AND id <> o.id AND status = 'offered';
  UPDATE public.requests SET assigned_to = o.rep_id, assigned_at = now(), updated_at = now() WHERE id = o.request_id AND assigned_to IS NULL;
  INSERT INTO public.audit_log(table_name, record_id, action, new_data, user_id, company_id)
  VALUES ('requests', o.request_id, 'request_offer_accepted', jsonb_build_object('offer_id', o.id, 'wave', o.wave), o.rep_id, o.company_id);
  RETURN 'accepted';
END $$;

CREATE OR REPLACE FUNCTION public.pass_request_offer(p_offer uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.request_offers SET status = 'passed', responded_at = now() WHERE id = p_offer AND rep_id = auth.uid() AND status = 'offered' RETURNING 'passed'::text;
$$;
GRANT EXECUTE ON FUNCTION public.my_request_offers(), public.accept_request_offer(uuid), public.pass_request_offer(uuid) TO authenticated;
