DO $t$
DECLARE r jsonb := '{}'::jsonb; v text; n int; j jsonb;
  TH uuid := '8fc39364-ce8e-4ac7-9b0a-c14bdc05ac84'; LI uuid := '3110e042-1a09-48d7-ba36-2b51d9d4aa59'; AD uuid := '420c7731-e8a4-4355-80ca-51c684b42a2c';
  E uuid := 'edd58d95-ded4-4283-ae48-7c609ed617f0'; P uuid := '7258afef-cb77-4707-a9c9-1c14ea08e055'; K uuid := '66c17a64-72b0-44cc-8a5b-f335ff097397';
BEGIN
  r := r || jsonb_build_object('booked_E', public._same_client_booked(E), 'booked_P', public._same_client_booked(P), 'booked_K', public._same_client_booked(K));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', TH, 'role','authenticated')::text, true);
  BEGIN
    UPDATE public.leads SET assigned_agent_id = TH, status='accepted', scheduled_date='2026-10-13', scheduled_time='12:30' WHERE id = E;
    GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('thabo_claim_E_trigger', 'ALLOWED rows='||n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('thabo_claim_E_trigger', SQLERRM); END;
  BEGIN UPDATE public.leads SET assigned_agent_id = TH WHERE id = K; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('thabo_touch_own_K','ok rows='||n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('thabo_touch_own_K', SQLERRM); END;
  PERFORM set_config('role','authenticated', true);
  r := r || jsonb_build_object('thabo_sees_E', (SELECT count(*) FROM leads WHERE id=E), 'thabo_sees_K', (SELECT count(*) FROM leads WHERE id=K));
  j := public.tech_offers();
  r := r || jsonb_build_object('thabo_offers', (SELECT jsonb_agg(o->>'lead_id') FROM jsonb_array_elements(j->'offers') o));
  BEGIN PERFORM * FROM public.client_open_bookings('+27696838624'); r := r || '{"thabo_cob":"allowed"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('thabo_cob', SQLERRM); END;
  SELECT count(*) INTO n FROM public.lead_duplicate_flags(); r := r || jsonb_build_object('thabo_flags', n);
  -- Lisa
  PERFORM set_config('request.jwt.claims', json_build_object('sub', LI, 'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM public.lead_duplicate_flags(); r := r || jsonb_build_object('lisa_flags', n);
  BEGIN PERFORM * FROM public.client_open_bookings('+27696838624'); r := r || '{"lisa_cob":"allowed"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('lisa_cob', SQLERRM); END;
  BEGIN PERFORM public.resolve_duplicate_lead(E,'cancel',K); r := r || '{"lisa_resolve":"allowed"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('lisa_resolve', SQLERRM); END;
  SELECT count(*) INTO n FROM public.rep_offerable_leads(); r := r || jsonb_build_object('lisa_rep_offers', n);
  -- Admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', AD, 'role','authenticated')::text, true);
  r := r || jsonb_build_object('admin_cob_phone', (SELECT jsonb_agg(jsonb_build_object('id',left(lead_id::text,8),'st',status,'d',scheduled_date,'t',tech_name,'b',booked,'m',match)) FROM public.client_open_bookings('069 683 8624')));
  r := r || jsonb_build_object('admin_cob_email', (SELECT count(*) FROM public.client_open_bookings(NULL,'Botha.Johan@gmail.com ')));
  r := r || jsonb_build_object('admin_cob_addr_name', (SELECT jsonb_agg(match) FROM public.client_open_bookings(NULL,NULL,NULL,'2 Thompson Street, Strand 7140','Johan Botha')));
  r := r || jsonb_build_object('admin_cob_addr_othername', (SELECT count(*) FROM public.client_open_bookings(NULL,NULL,NULL,'2 Thompson Street, Strand','Mary Smith')));
  r := r || jsonb_build_object('admin_cob_none', (SELECT count(*) FROM public.client_open_bookings('0821111111')));
  r := r || jsonb_build_object('admin_flags', (SELECT jsonb_agg(left(lead_id::text,8)||'->'||left(other_lead_id::text,8)||':'||match) FROM public.lead_duplicate_flags()));
  -- keep_both on E => offered again, no flag pair
  PERFORM public.resolve_duplicate_lead(E,'keep_both',K);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', TH, 'role','authenticated')::text, true);
  j := public.tech_offers();
  r := r || jsonb_build_object('after_keep_thabo_offers', (SELECT jsonb_agg(o->>'lead_id') FROM jsonb_array_elements(j->'offers') o));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', AD, 'role','authenticated')::text, true);
  r := r || jsonb_build_object('after_keep_flags_E', (SELECT count(*) FROM public.lead_duplicate_flags() WHERE lead_id=E OR other_lead_id=E));
  PERFORM public.resolve_duplicate_lead(P,'merge',K);
  r := r || jsonb_build_object('after_merge_P', (SELECT jsonb_build_object('st',status,'m',merged_into_id,'h',merge_history->-1->>'action') FROM leads WHERE id=P),
     'K_hist', (SELECT merge_history->-1->>'action' FROM leads WHERE id=K));
  RAISE EXCEPTION 'RESULT %', r;
END $t$;
