-- Rollback same-client duplicate guard (12 Oct 2026). Restores tech_offers/rep_offerable_leads exactly as before.
DROP TRIGGER IF EXISTS trg_same_client_claim_guard ON public.leads;
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
     AND f.fits
   ORDER BY f.km NULLS LAST;
$function$;
DROP FUNCTION IF EXISTS public._same_client_claim_guard();
DROP FUNCTION IF EXISTS public.resolve_duplicate_lead(uuid,text,uuid);
DROP FUNCTION IF EXISTS public.lead_duplicate_flags();
DROP FUNCTION IF EXISTS public._same_client_booked(uuid);
DROP FUNCTION IF EXISTS public.client_open_bookings(text,text,uuid,text,text,uuid);
DROP FUNCTION IF EXISTS public._client_open_bookings(uuid,uuid,text,text,text,text,uuid);
DROP FUNCTION IF EXISTS public._norm_addr(text);
-- Columns kept (harmless, hold office decisions). To remove fully:
-- ALTER TABLE public.leads DROP COLUMN IF EXISTS second_visit_of, DROP COLUMN IF EXISTS dup_ok;
