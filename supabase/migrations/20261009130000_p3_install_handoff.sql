-- ALREADY APPLIED to prod via SQL on 2026-10-09. Rollback: /workspace/p3-handoff-2026-10-09/rollback.sql
-- P3 Hand to technician (2026-10-09). Controlled server-side hand-off that respects the sales dispatch lockdown.
-- Office (admin / non-sales dispatcher, own company): Pick technician or Offer to technicians.
-- Salesperson: own accepted quote only, Offer to technicians only (never names/changes a tech).
-- In-app notifications only. No WhatsApp/SMS/email. Lead broadcast / auto-assign / edge functions untouched.
-- Install offers keep expires_at far in the future so the existing process-expired-offers edge function
-- (which cascades lead offers and may message) never picks them up; the real deadline is offers.respond_by.
-- Fit check reuses the shared _staff_slot_fit (same rules as lead filtering / tech offers fit).

ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS respond_by timestamptz;
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_offer_type_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_offer_type_check CHECK (offer_type = ANY (ARRAY['sales_estimate','service_call','install']));
DROP INDEX IF EXISTS public.uniq_accepted_offer_per_lead;
CREATE UNIQUE INDEX uniq_accepted_offer_per_lead ON public.offers (lead_id) WHERE status = 'accepted' AND job_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_accepted_offer_per_job ON public.offers (job_id) WHERE status = 'accepted' AND job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offers_install_job ON public.offers (job_id, status) WHERE job_id IS NOT NULL;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS install_handoff_default text NOT NULL DEFAULT 'manual';
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_install_handoff_default_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_install_handoff_default_check CHECK (install_handoff_default IN ('manual','auto'));

-- who may hand over this quote: 'ops' | 'rep' | NULL
CREATE OR REPLACE FUNCTION public._p3_handoff_role(_uid uuid, _quote uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT CASE
    WHEN _uid IS NULL OR q.id IS NULL THEN NULL
    WHEN public.is_sales_rep(_uid) THEN
      CASE WHEN _uid IN (q.sales_engineer_id, q.owner_id, q.created_by) AND q.company_id = public.caller_company_id() THEN 'rep' END
    WHEN (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'dispatcher')) AND q.company_id = public.caller_company_id() THEN 'ops'
  END
  FROM (SELECT 1) one LEFT JOIN public.quotes q ON q.id = _quote;
$f$;

CREATE OR REPLACE FUNCTION public._p3_suburb(_addr text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $f$
  SELECT CASE WHEN _addr IS NULL OR btrim(_addr) = '' THEN NULL
              WHEN array_length(string_to_array(_addr, ','), 1) >= 2 THEN btrim(split_part(_addr, ',', 2))
              ELSE btrim(_addr) END;
$f$;

CREATE OR REPLACE FUNCTION public._p3_is_tech(_pid uuid, _company uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _pid AND p.company_id = _company
     AND COALESCE(p.dispatch_active, true)
     AND COALESCE(p.dispatch_role, 'technician') NOT IN ('sales', 'sales_engineer')
     AND public.has_role(p.id, 'field_agent'));
$f$;

-- one offer round for an install job; returns number of technicians offered
CREATE OR REPLACE FUNCTION public._p3_offer_round(p_job uuid, p_round int)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE j record; v_local timestamp; d date; t time; v_min int; v_fit_min int; v_radius numeric; p record; f record;
  v_n int := 0; v_body text; v_oid uuid; v_by timestamptz := now() + interval '15 minutes';
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL OR j.lead_id IS NULL OR j.scheduled_for IS NULL THEN RETURN 0; END IF;
  v_local := j.scheduled_for AT TIME ZONE 'Africa/Johannesburg'; d := v_local::date; t := v_local::time;
  v_min := GREATEST(COALESCE((extract(epoch FROM j.estimated_duration) / 60)::int, 240), 30);
  v_fit_min := LEAST(v_min, 480);  -- multi-day installs: check the first day
  v_radius := 50 * GREATEST(p_round, 1);
  v_body := concat_ws(' · ', public._p3_suburb(j.address), to_char(d, 'Dy DD Mon') || ' ' || to_char(t, 'HH24:MI'),
    CASE WHEN v_min >= 960 THEN '2 days' WHEN v_min >= 480 THEN 'Full day' WHEN v_min % 60 = 0 THEN (v_min / 60)::text || ' h' ELSE round(v_min / 60.0, 1)::text || ' h' END);
  FOR p IN SELECT pr.id FROM public.profiles pr WHERE public._p3_is_tech(pr.id, j.company_id)
     AND NOT EXISTS (SELECT 1 FROM public.offers o WHERE o.job_id = p_job AND o.staff_id = pr.id AND o.status IN ('declined', 'pending'))
  LOOP
    SELECT * INTO f FROM public._staff_slot_fit(p.id, j.lead_id, d, t, v_fit_min, j.lat, j.lng, NULL);
    IF NOT COALESCE(f.fits, false) THEN
      IF f.reason IN ('Busy at that time', 'Outside working hours', 'Not working that day', 'No free time that day',
                      'Not enough travel time', 'No time to reach the next job') THEN CONTINUE; END IF;
      IF f.km IS NOT NULL AND f.km > v_radius THEN CONTINUE; END IF;
    END IF;
    INSERT INTO public.offers (lead_id, job_id, staff_id, company_id, offer_type, sequence, status, distance_km, expires_at, respond_by)
    VALUES (j.lead_id, p_job, p.id, j.company_id, 'install', p_round, 'pending', f.km, '2999-01-01'::timestamptz, v_by)
    RETURNING id INTO v_oid;
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (p.id, 'install_offer', 'Installation offer', v_body, p_job,
            jsonb_build_object('offer_id', v_oid, 'job_id', p_job, 'respond_by', v_by, 'link', '/field'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $f$;

CREATE OR REPLACE FUNCTION public._p3_notify_unclaimed(p_job uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE j record; q record; u uuid;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE type = 'install_offer_unclaimed' AND related_id = p_job) THEN RETURN; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = j.quote_id;
  FOR u IN SELECT DISTINCT x FROM (
      SELECT q.sales_engineer_id AS x
      UNION SELECT cm.user_id FROM public.company_members cm WHERE cm.company_id = j.company_id AND cm.role = 'admin'
      UNION SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles pr ON pr.id = ur.user_id
             WHERE ur.role = 'admin' AND pr.company_id = j.company_id) s WHERE x IS NOT NULL
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (u, 'install_offer_unclaimed', 'No technician took the installation',
            'No technician took the installation for ' || COALESCE(q.customer_name, 'the client') || ' — pick one', p_job,
            jsonb_build_object('job_id', p_job, 'quote_id', j.quote_id, 'link', COALESCE('/admin/estimates/' || j.quote_id::text, '/admin/jobs/' || p_job::text)));
  END LOOP;
END $f$;

-- THE controlled hand-off
CREATE OR REPLACE FUNCTION public.hand_to_technician(p_quote_id uuid, p_date date, p_start time, p_minutes int,
  p_mode text, p_tech_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_role text; q record; v_inv uuid; j record; v_job uuid; v_addr text; v_lat double precision; v_lng double precision;
  v_for timestamptz; v_end time; v_n int; v_tname text;
BEGIN
  IF p_mode NOT IN ('pick', 'offer') THEN RAISE EXCEPTION 'Choose Pick technician or Offer to technicians'; END IF;
  IF p_date IS NULL OR p_start IS NULL THEN RAISE EXCEPTION 'Date and start time are required'; END IF;
  IF p_minutes IS NULL OR p_minutes < 30 OR p_minutes > 2880 THEN RAISE EXCEPTION 'Duration must be between 30 minutes and 2 days'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  v_role := public._p3_handoff_role(v_uid, p_quote_id);
  IF v_role IS NULL THEN RAISE EXCEPTION 'You can''t hand over this quote' USING ERRCODE = '42501'; END IF;
  IF v_role = 'rep' AND p_mode = 'pick' THEN
    RAISE EXCEPTION 'Salespeople can''t assign technicians — use Offer to technicians' USING ERRCODE = '42501'; END IF;
  IF lower(COALESCE(q.status, '')) <> 'accepted' THEN RAISE EXCEPTION 'Quote is not accepted'; END IF;
  SELECT id INTO v_inv FROM public.invoices WHERE quote_id = q.id ORDER BY created_at LIMIT 1;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Deposit invoice required first'; END IF;
  IF p_mode = 'offer' AND q.lead_id IS NULL THEN RAISE EXCEPTION 'This quote has no lead, so it can''t be offered — pick a technician'; END IF;
  IF p_mode = 'pick' AND NOT public._p3_is_tech(p_tech_id, q.company_id) THEN RAISE EXCEPTION 'Pick an active technician in your company'; END IF;

  SELECT * INTO j FROM public.jobs WHERE quote_id = q.id AND job_type = 'installation' ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF j.id IS NOT NULL THEN
    SELECT pr.full_name INTO v_tname FROM public.assignments a JOIN public.profiles pr ON pr.id = a.profile_id
     WHERE a.job_id = j.id AND a.status <> 'rejected' LIMIT 1;
    IF v_tname IS NOT NULL OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = j.id AND a.status <> 'rejected') THEN
      RETURN jsonb_build_object('ok', false, 'job_id', j.id, 'message', 'Already handed over to ' || COALESCE(v_tname, 'a technician'));
    END IF;
    IF EXISTS (SELECT 1 FROM public.offers WHERE job_id = j.id AND status = 'pending' AND respond_by > now()) THEN
      IF p_mode = 'offer' OR v_role = 'rep' THEN
        RETURN jsonb_build_object('ok', false, 'job_id', j.id, 'message', 'Already offered to technicians — waiting for someone to accept');
      END IF;
      UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = j.id AND status = 'pending';
    END IF;
  END IF;

  IF q.lead_id IS NOT NULL THEN
    SELECT customer_address, latitude, longitude INTO v_addr, v_lat, v_lng FROM public.leads WHERE id = q.lead_id;
  END IF;
  IF (v_addr IS NULL OR v_lat IS NULL) AND q.customer_id IS NOT NULL THEN
    SELECT COALESCE(v_addr, c.address), COALESCE(v_lat, c.latitude), COALESCE(v_lng, c.longitude) INTO v_addr, v_lat, v_lng
      FROM public.customers c WHERE c.id = q.customer_id;
  END IF;
  v_for := (p_date + p_start) AT TIME ZONE 'Africa/Johannesburg';
  v_end := (LEAST(extract(epoch FROM p_start)::int / 60 + p_minutes, 23 * 60 + 59) * interval '1 minute')::time;

  IF j.id IS NULL THEN
    INSERT INTO public.jobs (company_id, customer_id, lead_id, quote_id, invoice_id, job_type, status, title, description,
                             address, lat, lng, scheduled_for, estimated_duration, created_by)
    VALUES (q.company_id, q.customer_id, q.lead_id, q.id, v_inv, 'installation', 'scheduled',
            'Installation — ' || COALESCE(q.customer_name, 'Customer'),
            btrim('Installation from accepted quote ' || COALESCE(q.quote_number, '')),
            v_addr, v_lat, v_lng, v_for, make_interval(mins => p_minutes), v_uid)
    RETURNING id INTO v_job;
  ELSE
    v_job := j.id;
    UPDATE public.jobs SET scheduled_for = v_for, estimated_duration = make_interval(mins => p_minutes),
           lat = COALESCE(lat, v_lat), lng = COALESCE(lng, v_lng), address = COALESCE(address, v_addr), updated_at = now()
     WHERE id = v_job;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = v_job) AND q.lead_id IS NOT NULL THEN
    INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
    VALUES (q.lead_id, v_job, NULL, p_date, p_start, v_end, btrim('Installation — quote ' || COALESCE(q.quote_number, '')));
  ELSE
    UPDATE public.job_schedules SET scheduled_date = p_date, start_time = p_start, end_time = v_end, updated_at = now() WHERE job_id = v_job;
  END IF;

  IF p_mode = 'pick' THEN
    INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
    VALUES (v_job, p_tech_id, 'accepted', 'internal', v_uid);
    SELECT full_name INTO v_tname FROM public.profiles WHERE id = p_tech_id;
    RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'pick', 'message', 'Handed to ' || COALESCE(v_tname, 'technician'));
  END IF;

  v_n := public._p3_offer_round(v_job, 1);
  IF v_n = 0 THEN
    PERFORM public._p3_notify_unclaimed(v_job);
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job, 'mode', 'offer', 'offered', v_n,
    'message', CASE WHEN v_n = 0 THEN 'No technician is free then — the office has been asked to pick one'
                    ELSE 'Offered to ' || v_n || ' technician' || CASE WHEN v_n = 1 THEN '' ELSE 's' END || ' — first to accept gets it' END);
END $f$;

CREATE OR REPLACE FUNCTION public.claim_install_offer(p_offer_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); o record; j record; q record; v_name text;
BEGIN
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id AND offer_type = 'install';
  IF o.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Offer not found'); END IF;
  IF o.staff_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok', false, 'message', 'This offer is for someone else'); END IF;
  SELECT * INTO j FROM public.jobs WHERE id = o.job_id FOR UPDATE;  -- serialises competing claims
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.offers WHERE job_id = o.job_id AND status = 'accepted')
     OR EXISTS (SELECT 1 FROM public.assignments WHERE job_id = o.job_id AND status <> 'rejected') THEN
    UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE id = p_offer_id AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'message', 'Already taken by another technician');
  END IF;
  IF o.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'message', 'This offer is no longer open'); END IF;
  IF o.respond_by < now() THEN
    UPDATE public.offers SET status = 'expired', responded_at = now() WHERE id = p_offer_id;
    RETURN jsonb_build_object('ok', false, 'message', 'Offer expired');
  END IF;
  UPDATE public.offers SET status = 'accepted', responded_at = now() WHERE id = p_offer_id;
  UPDATE public.offers SET status = 'cancelled', responded_at = now() WHERE job_id = o.job_id AND id <> p_offer_id AND status = 'pending';
  INSERT INTO public.assignments (job_id, profile_id, status, assignment_type, assigned_by)
  VALUES (o.job_id, v_uid, 'accepted', 'internal', v_uid);
  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_uid;
  SELECT * INTO q FROM public.quotes WHERE id = j.quote_id;
  IF q.sales_engineer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (q.sales_engineer_id, 'install_offer_taken', 'Installation taken',
            COALESCE(v_name, 'A technician') || ' took the installation for ' || COALESCE(q.customer_name, 'the client'), o.job_id,
            jsonb_build_object('job_id', o.job_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'job_id', o.job_id, 'message', 'It''s yours');
END $f$;

CREATE OR REPLACE FUNCTION public.decline_install_offer(p_offer_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  UPDATE public.offers SET status = 'declined', responded_at = now()
   WHERE id = p_offer_id AND offer_type = 'install' AND staff_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'message', 'This offer is no longer open'); END IF;
  RETURN jsonb_build_object('ok', true);
END $f$;

-- technician inbox: no money, client first name only
CREATE OR REPLACE FUNCTION public.my_install_offers()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'offer_id', o.id, 'job_id', o.job_id,
    'client', split_part(btrim(COALESCE(l.customer_name, 'Client')), ' ', 1),
    'suburb', public._p3_suburb(j.address),
    'date', ((j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date),
    'start', to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'),
    'minutes', (extract(epoch FROM j.estimated_duration) / 60)::int,
    'distance_km', o.distance_km, 'respond_by', o.respond_by) ORDER BY o.respond_by), '[]'::jsonb)
  FROM public.offers o JOIN public.jobs j ON j.id = o.job_id LEFT JOIN public.leads l ON l.id = o.lead_id
  WHERE o.staff_id = auth.uid() AND o.offer_type = 'install' AND o.status = 'pending' AND o.respond_by > now();
$f$;

-- hand-off status for the sheet (office / own rep)
CREATE OR REPLACE FUNCTION public.install_handoff_status(p_quote_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_role text := public._p3_handoff_role(auth.uid(), p_quote_id); j record; v_default text; v_tech text;
BEGIN
  IF v_role IS NULL THEN RETURN NULL; END IF;
  SELECT c.install_handoff_default INTO v_default FROM public.quotes q JOIN public.companies c ON c.id = q.company_id WHERE q.id = p_quote_id;
  SELECT * INTO j FROM public.jobs WHERE quote_id = p_quote_id AND job_type = 'installation' ORDER BY created_at LIMIT 1;
  IF j.id IS NOT NULL THEN
    SELECT pr.full_name INTO v_tech FROM public.assignments a JOIN public.profiles pr ON pr.id = a.profile_id
     WHERE a.job_id = j.id AND a.status <> 'rejected' LIMIT 1;
  END IF;
  RETURN jsonb_build_object('role', v_role, 'default_mode', COALESCE(v_default, 'manual'), 'job_id', j.id,
    'technician', v_tech,
    'pending', (SELECT count(*) FROM public.offers WHERE job_id = j.id AND status = 'pending' AND respond_by > now()),
    'round', (SELECT max(sequence) FROM public.offers WHERE job_id = j.id),
    'unclaimed', EXISTS (SELECT 1 FROM public.notifications WHERE type = 'install_offer_unclaimed' AND related_id = j.id));
END $f$;

CREATE OR REPLACE FUNCTION public.set_install_handoff_default(p_mode text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_co uuid := public.caller_company_id();
BEGIN
  IF p_mode NOT IN ('manual', 'auto') THEN RAISE EXCEPTION 'Invalid mode'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') OR v_co IS NULL THEN RAISE EXCEPTION 'Admins only' USING ERRCODE = '42501'; END IF;
  UPDATE public.companies SET install_handoff_default = p_mode WHERE id = v_co;
  RETURN jsonb_build_object('ok', true, 'mode', p_mode);
END $f$;

-- cron worker: expire, re-offer once at double radius, then alert rep + company admins (in-app)
CREATE OR REPLACE FUNCTION public.process_install_offers()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE r record; v_n int := 0; v_new int;
BEGIN
  UPDATE public.offers SET status = 'expired', responded_at = now()
   WHERE offer_type = 'install' AND status = 'pending' AND respond_by < now();
  FOR r IN SELECT o.job_id, max(o.sequence) AS seq FROM public.offers o
     WHERE o.offer_type = 'install' AND o.job_id IS NOT NULL GROUP BY o.job_id
     HAVING bool_and(o.status <> 'pending') AND bool_and(o.status <> 'accepted')
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.assignments WHERE job_id = r.job_id AND status <> 'rejected');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications WHERE type = 'install_offer_unclaimed' AND related_id = r.job_id);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.jobs WHERE id = r.job_id AND status IN ('cancelled', 'completed'));
    v_new := 0;
    IF r.seq < 2 THEN v_new := public._p3_offer_round(r.job_id, 2); END IF;
    IF v_new = 0 THEN PERFORM public._p3_notify_unclaimed(r.job_id); END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $f$;

-- rep alert when their quote is accepted (in-app)
CREATE OR REPLACE FUNCTION public.p3_notify_quote_accepted()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'accepted' AND lower(COALESCE(OLD.status, '')) <> 'accepted'
     AND NEW.sales_engineer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE quote_id = NEW.id AND job_type = 'installation') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (NEW.sales_engineer_id, 'quote_accepted_handover',
            'Quote ' || COALESCE(NEW.quote_number, '') || ' accepted — hand to technician',
            COALESCE(NEW.customer_name, 'Client') || ' accepted. Open the visit to hand it over.', NEW.id,
            jsonb_build_object('quote_id', NEW.id, 'lead_id', NEW.lead_id,
              'link', CASE WHEN NEW.lead_id IS NOT NULL THEN '/admin/visits/' || NEW.lead_id::text ELSE '/admin/estimates/' || NEW.id::text END));
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS p3_quote_accepted_handover ON public.quotes;
CREATE TRIGGER p3_quote_accepted_handover AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.p3_notify_quote_accepted();

REVOKE ALL ON FUNCTION public._p3_handoff_role(uuid, uuid), public._p3_is_tech(uuid, uuid), public._p3_offer_round(uuid, int),
  public._p3_notify_unclaimed(uuid), public.process_install_offers(), public.p3_notify_quote_accepted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hand_to_technician(uuid, date, time, int, text, uuid), public.claim_install_offer(uuid),
  public.decline_install_offer(uuid), public.my_install_offers(), public.install_handoff_status(uuid),
  public.set_install_handoff_default(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hand_to_technician(uuid, date, time, int, text, uuid), public.claim_install_offer(uuid),
  public.decline_install_offer(uuid), public.my_install_offers(), public.install_handoff_status(uuid),
  public.set_install_handoff_default(text) TO authenticated;

SELECT cron.unschedule('p3-install-offers') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p3-install-offers');
SELECT cron.schedule('p3-install-offers', '* * * * *', 'SELECT public.process_install_offers()');
