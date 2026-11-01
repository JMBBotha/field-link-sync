-- Johan 1 Nov (t2045u): set the exact map pin on a booking. Same rights as booking edit (admin or the booking's rep);
-- address is never overwritten here. Every change goes to audit_log (source 'booking_pin').
CREATE OR REPLACE FUNCTION public.set_booking_pin(p_lead uuid, p_lat numeric, p_lng numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); l public.leads%ROWTYPE; p jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE='22023'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND OR l.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE='42501'; END IF;
  p := public.booking_edit_perms(p_lead);
  IF NOT ((p->>'admin')::boolean OR (p->>'rep')::boolean) THEN RAISE EXCEPTION 'You can''t edit this booking' USING ERRCODE='42501'; END IF;
  IF l.latitude = p_lat AND l.longitude = p_lng THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  UPDATE public.leads SET latitude = p_lat, longitude = p_lng WHERE id = p_lead;
  INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('leads', p_lead, 'update', jsonb_build_object('source','booking_pin','latitude', l.latitude, 'longitude', l.longitude),
            jsonb_build_object('source','booking_pin','latitude', p_lat, 'longitude', p_lng), v_uid, l.company_id);
  RETURN jsonb_build_object('ok', true, 'changed', true);
END $function$;
REVOKE ALL ON FUNCTION public.set_booking_pin(uuid, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_booking_pin(uuid, numeric, numeric) TO authenticated;
