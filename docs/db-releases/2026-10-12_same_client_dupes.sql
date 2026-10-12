-- Same-client duplicate bookings (12 Oct 2026). Rollback: rollback.sql
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dup_ok boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS second_visit_of uuid REFERENCES public.leads(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.leads.dup_ok IS 'Office/admin confirmed: legitimate second visit for the same client (no duplicate flag/guard)';

CREATE OR REPLACE FUNCTION public._norm_addr(a text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT CASE WHEN a IS NULL OR a ILIKE 'address pending%' THEN NULL
    ELSE NULLIF(regexp_replace(regexp_replace(lower(a), ',?\s*\d{4}\s*$', ''), '[^a-z0-9]', '', 'g'), '') END
$f$;

-- Open leads of the same client. strong = same customer / phone / email; soft = same address + similar name.
CREATE OR REPLACE FUNCTION public._client_open_bookings(p_company uuid, p_customer uuid, p_phone text, p_email text,
  p_address text, p_name text, p_exclude uuid)
 RETURNS TABLE(lead_id uuid, customer_name text, status text, scheduled_date date, scheduled_time time without time zone,
   tech_id uuid, tech_name text, booked boolean, match text, dup_ok boolean, second_visit_of uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  WITH k AS (SELECT public.normalize_phone(NULLIF(trim(p_phone), '')) ph, NULLIF(lower(trim(p_email)), '') em,
                    public._norm_addr(p_address) ad, lower(trim(COALESCE(p_name, ''))) nm),
  c AS (
    SELECT l.*, pr.full_name AS tname,
      ((p_customer IS NOT NULL AND l.customer_id = p_customer)
        OR (k.ph IS NOT NULL AND length(k.ph) >= 9 AND public.normalize_phone(l.customer_phone) = k.ph)
        OR (k.em IS NOT NULL AND lower(trim(l.email)) = k.em)) AS strong,
      (k.ad IS NOT NULL AND k.nm <> '' AND public._norm_addr(l.customer_address) = k.ad
        AND similarity(lower(COALESCE(l.customer_name, '')), k.nm) >= 0.4) AS soft
    FROM public.leads l CROSS JOIN k LEFT JOIN public.profiles pr ON pr.id = l.assigned_agent_id
    WHERE l.company_id = p_company AND l.id IS DISTINCT FROM p_exclude
      AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
      AND l.status IN ('pending','open','released','new','claimed','accepted','in_progress','scheduled')
      AND (l.status = 'in_progress' OR l.scheduled_date IS NULL
           OR l.scheduled_date >= (now() AT TIME ZONE 'Africa/Johannesburg')::date))
  SELECT c.id, c.customer_name, c.status, c.scheduled_date, c.scheduled_time, c.assigned_agent_id, c.tname,
    (c.status IN ('claimed','accepted','in_progress','scheduled') OR (c.assigned_agent_id IS NOT NULL AND c.scheduled_date IS NOT NULL)),
    CASE WHEN c.strong THEN 'strong' ELSE 'soft' END, c.dup_ok, c.second_visit_of
  FROM c WHERE c.strong OR c.soft
  ORDER BY 8 DESC, (c.strong) DESC, c.scheduled_date NULLS LAST, c.created_at
$f$;
REVOKE ALL ON FUNCTION public._client_open_bookings(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- App RPC for the New Lead dialog (staff of the caller's company).
CREATE OR REPLACE FUNCTION public.client_open_bookings(p_phone text, p_email text DEFAULT NULL, p_customer_id uuid DEFAULT NULL,
  p_address text DEFAULT NULL, p_name text DEFAULT NULL, p_exclude_lead uuid DEFAULT NULL)
 RETURNS TABLE(lead_id uuid, customer_name text, status text, scheduled_date date, scheduled_time time without time zone,
   tech_id uuid, tech_name text, booked boolean, match text, dup_ok boolean, second_visit_of uuid)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_ops_user(auth.uid()) OR public.is_sales_rep(auth.uid()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public._client_open_bookings(public.get_user_company_id(auth.uid()), p_customer_id, p_phone, p_email,
    p_address, p_name, p_exclude_lead);
END $f$;
REVOKE ALL ON FUNCTION public.client_open_bookings(text,text,uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_open_bookings(text,text,uuid,text,text,uuid) TO authenticated;

-- Another lead of the same client (strong match) is already booked.
CREATE OR REPLACE FUNCTION public._same_client_booked(p_lead uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT EXISTS (SELECT 1 FROM public.leads l
    CROSS JOIN LATERAL public._client_open_bookings(l.company_id, l.customer_id, l.customer_phone, l.email, NULL, NULL, l.id) b
    WHERE l.id = p_lead AND NOT l.dup_ok AND b.booked AND b.match = 'strong')
$f$;
REVOKE ALL ON FUNCTION public._same_client_booked(uuid) FROM PUBLIC, anon, authenticated;

-- Offer lists: hide leads whose client is already booked (unless office marked it a second visit).
CREATE OR REPLACE FUNCTION public.tech_offers(p_profile uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_pid uuid; v_co uuid; v_all boolean := false; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('applies', false, 'offers', '[]'::jsonb); END IF;
  IF p_profile IS NULL OR p_profile = v_uid THEN
    IF NOT public.is_field_tech_only(v_uid) THEN RETURN jsonb_build_object('applies', false, 'offers', '[]'::jsonb); END IF;
    v_pid := v_uid;
  ELSE
    SELECT company_id INTO v_co FROM public.profiles WHERE id = p_profile;
    IF NOT (public.has_role(v_uid, 'admin') OR (public.rh_ops_ok(v_co) AND NOT public.is_sales_rep(v_uid))) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    v_pid := p_profile; v_all := true;
  END IF;
  v_co := public.get_user_company_id(v_pid);
  SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.fits DESC, o.km NULLS LAST), '[]'::jsonb) INTO v_out FROM (
    SELECT l.id AS lead_id, f.fits, f.km, f.label, f.reason, f.slot_date, f.slot_start, f.minutes, f.minutes_source
      FROM public.leads l CROSS JOIN LATERAL public._tech_offer_fit(v_pid, l.id) f
     WHERE l.company_id = v_co AND l.assigned_agent_id IS NULL AND l.status IN ('pending', 'open', 'released')
       AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
       AND COALESCE(l.primary_intent::text, 'service') = 'service'
       AND NOT public._same_client_booked(l.id)
       AND (v_all OR f.fits)) o;
  RETURN jsonb_build_object('applies', true, 'offers', v_out);
END $function$;

CREATE OR REPLACE FUNCTION public.rep_offerable_leads()
 RETURNS TABLE(lead_id uuid, km numeric, label text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT l.id, f.km, f.label
    FROM public.leads l CROSS JOIN LATERAL public._rep_lead_fit(auth.uid(), l.id) f
   WHERE auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())
     AND l.company_id = public.get_user_company_id(auth.uid())
     AND l.assigned_agent_id IS NULL AND l.status = 'pending'
     AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND COALESCE(l.primary_intent::text, 'sales') = 'sales'
     AND NOT public._same_client_booked(l.id)
     AND f.fits
   ORDER BY f.km NULLS LAST;
$function$;

-- Server-side: techs/reps can't take a lead whose client is already booked; office/admin can (they get the dialog).
CREATE OR REPLACE FUNCTION public._same_client_claim_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); b record;
BEGIN
  IF v_uid IS NULL OR NEW.dup_ok OR NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
  IF public.is_ops_user(v_uid) AND NOT public.is_sales_rep(v_uid) THEN RETURN NEW; END IF;
  IF NOT (OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id
          OR (NEW.status IN ('claimed','accepted','in_progress','scheduled') AND OLD.status IS DISTINCT FROM NEW.status)) THEN
    RETURN NEW; END IF;
  SELECT * INTO b FROM public._client_open_bookings(NEW.company_id, NEW.customer_id, NEW.customer_phone, NEW.email, NULL, NULL, NEW.id) x
   WHERE x.booked AND x.match = 'strong' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This client already has a booking on % with %. Ask the office to add it as a second visit.',
      COALESCE(to_char(b.scheduled_date, 'Dy DD Mon') || ' ' || to_char(b.scheduled_time, 'HH24:MI'), 'an open date'),
      COALESCE(b.tech_name, 'someone') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_same_client_claim_guard ON public.leads;
CREATE TRIGGER trg_same_client_claim_guard BEFORE UPDATE OF assigned_agent_id, status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public._same_client_claim_guard();

-- Admin/office: open leads that share a client with another open lead.
CREATE OR REPLACE FUNCTION public.lead_duplicate_flags()
 RETURNS TABLE(lead_id uuid, other_lead_id uuid, other_status text, other_date date, other_time time without time zone,
   other_tech text, other_booked boolean, match text, n_others int)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_ops_user(v_uid) OR public.is_sales_rep(v_uid) THEN RETURN; END IF;
  RETURN QUERY
  SELECT l.id, b.lead_id, b.status, b.scheduled_date, b.scheduled_time, b.tech_name, b.booked, b.match,
         (count(*) OVER (PARTITION BY l.id))::int
    FROM public.leads l
    CROSS JOIN LATERAL public._client_open_bookings(l.company_id, l.customer_id, l.customer_phone, l.email,
      l.customer_address, l.customer_name, l.id) b
   WHERE l.company_id = public.get_user_company_id(v_uid) AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND l.status IN ('pending','open','released','new','claimed','accepted','in_progress','scheduled')
     AND (l.status = 'in_progress' OR l.scheduled_date IS NULL OR l.scheduled_date >= (now() AT TIME ZONE 'Africa/Johannesburg')::date)
     AND NOT (l.dup_ok AND l.second_visit_of = b.lead_id)
     AND NOT (b.dup_ok AND b.second_visit_of = l.id)
     AND NOT (l.dup_ok AND l.second_visit_of IS NULL);
END $f$;
REVOKE ALL ON FUNCTION public.lead_duplicate_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_duplicate_flags() TO authenticated;

-- Admin/office fix actions: merge | cancel | keep_both. Never deletes.
CREATE OR REPLACE FUNCTION public.resolve_duplicate_lead(p_lead uuid, p_action text, p_target uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); s public.leads; t public.leads; v_by text;
BEGIN
  IF v_uid IS NOT NULL AND (NOT public.is_ops_user(v_uid) OR public.is_sales_rep(v_uid)) THEN
    RAISE EXCEPTION 'Only admin or office can fix duplicates' USING ERRCODE = '42501'; END IF;
  IF p_lead = p_target THEN RAISE EXCEPTION 'Pick a different booking'; END IF;
  SELECT * INTO s FROM public.leads WHERE id = p_lead FOR UPDATE;
  SELECT * INTO t FROM public.leads WHERE id = p_target FOR UPDATE;
  IF s.id IS NULL OR t.id IS NULL OR s.company_id IS DISTINCT FROM t.company_id
     OR (v_uid IS NOT NULL AND s.company_id IS DISTINCT FROM public.get_user_company_id(v_uid)) THEN
    RAISE EXCEPTION 'Lead not found'; END IF;
  v_by := COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'system');
  IF p_action = 'merge' THEN
    UPDATE public.leads SET merged_into_id = t.id, status = 'cancelled',
      cancellation_reason = '[same-client duplicate merged into ' || t.id || ' by ' || v_by || '; previous status: ' || s.status || ']',
      merge_history = COALESCE(merge_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_by,
        'action', 'merged_into', 'target', t.id, 'previous_status', s.status, 'previous_agent', s.assigned_agent_id,
        'previous_date', s.scheduled_date, 'previous_time', s.scheduled_time))
     WHERE id = s.id;
    UPDATE public.leads SET
      merge_history = COALESCE(merge_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_by,
        'action', 'absorbed', 'source', s.id, 'source_status', s.status, 'source_service', s.service_type)),
      email = COALESCE(t.email, s.email)
     WHERE id = t.id;
  ELSIF p_action = 'cancel' THEN
    UPDATE public.leads SET status = 'cancelled',
      cancellation_reason = '[same-client duplicate of ' || t.id || ', cancelled by ' || v_by || '; previous status: ' || s.status || ']',
      merge_history = COALESCE(merge_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_by,
        'action', 'cancelled_duplicate', 'target', t.id, 'previous_status', s.status))
     WHERE id = s.id;
  ELSIF p_action = 'keep_both' THEN
    UPDATE public.leads SET dup_ok = true, second_visit_of = t.id,
      merge_history = COALESCE(merge_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_by,
        'action', 'kept_as_second_visit', 'target', t.id))
     WHERE id = s.id;
  ELSE RAISE EXCEPTION 'Unknown action %', p_action; END IF;
  RETURN jsonb_build_object('ok', true, 'action', p_action, 'lead', s.id, 'target', t.id);
END $f$;
REVOKE ALL ON FUNCTION public.resolve_duplicate_lead(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_duplicate_lead(uuid,text,uuid) TO authenticated;
