DO $t$
DECLARE r jsonb := '{}'::jsonb; n int; j jsonb; L uuid; JB uuid;
  TH uuid := '8fc39364-ce8e-4ac7-9b0a-c14bdc05ac84'; AY uuid := '28030315-11db-4ce2-8caa-43b2c36a1aaf'; LI uuid := '3110e042-1a09-48d7-ba36-2b51d9d4aa59';
  P uuid := 'da66bc1f-645a-4a88-a38c-80d77435fb29'; -- TEST P10 Intake Check (pending, unassigned)
BEGIN
  UPDATE leads SET primary_intent='service', latitude=-34.103, longitude=18.8165 WHERE id=P;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', TH, 'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  UPDATE leads SET assigned_agent_id=TH, status='accepted' WHERE id=P; GET DIAGNOSTICS n = ROW_COUNT;
  r := r || jsonb_build_object('old_direct_update_rows', n);
  j := public.tech_offers();
  r := r || jsonb_build_object('offer', (SELECT o FROM jsonb_array_elements(j->'offers') o WHERE o->>'lead_id'=P::text));
  BEGIN PERFORM public.tech_accept_lead(P, '2026-10-13', '07:00', 60); r := r || '{"clash_or_hours":"ALLOWED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('clash_or_hours', SQLERRM); END;
  BEGIN j := public.tech_accept_lead(P, (j->'offers'->0->>'slot_date')::date, (j->'offers'->0->>'slot_start')::time, 60, NULL, 'TEST accept', NULL, NULL, NULL, NULL);
    r := r || jsonb_build_object('accept_fit', (SELECT status||' '||assigned_agent_id FROM leads WHERE id=P));
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('accept_fit', SQLERRM); END;
  r := r || jsonb_build_object('jobs', (SELECT count(*) FROM jobs WHERE lead_id=P), 'job_status', (SELECT max(status) FROM jobs WHERE lead_id=P), 'asg', (SELECT count(*) FROM assignments a JOIN jobs j ON j.id=a.job_id WHERE j.lead_id=P AND a.profile_id=TH AND a.status='accepted'), 'ret', j);
  -- Ayesha can't take it now
  PERFORM set_config('request.jwt.claims', json_build_object('sub', AY, 'role','authenticated')::text, true);
  BEGIN PERFORM public.tech_accept_lead(P, '2026-10-14', '10:00', 60); r := r || '{"second_tech":"ALLOWED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('second_tech', SQLERRM); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', LI, 'role','authenticated')::text, true);
  BEGIN PERFORM public.tech_accept_lead(P, '2026-10-14', '10:00', 60); r := r || '{"lisa":"ALLOWED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('lisa', SQLERRM); END;
  -- same-client: Thabo trying a 2nd Botha lead (simulate: un-merge copy)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', TH, 'role','authenticated')::text, true);
  PERFORM set_config('role','postgres', true);
  UPDATE leads SET merged_into_id=NULL, status='pending' WHERE id='edd58d95-ded4-4283-ae48-7c609ed617f0';
  PERFORM set_config('role','authenticated', true);
  BEGIN PERFORM public.tech_accept_lead('edd58d95-ded4-4283-ae48-7c609ed617f0', '2026-10-13', '12:30', 60); r := r || '{"same_client":"ALLOWED"}';
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('same_client', SQLERRM); END;
  RAISE EXCEPTION 'RESULT %', r;
END $t$;
