-- 1. Outbox table for reliable server-side side effects
CREATE TABLE public.entity_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_entity_outbox_pending ON public.entity_outbox (status, created_at) WHERE status = 'pending';
CREATE INDEX idx_entity_outbox_entity ON public.entity_outbox (entity_type, entity_id);

GRANT SELECT ON public.entity_outbox TO authenticated;
GRANT ALL ON public.entity_outbox TO service_role;

ALTER TABLE public.entity_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view their company outbox"
ON public.entity_outbox FOR SELECT TO authenticated
USING (
  company_id IS NOT NULL
  AND company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dispatcher'))
);

CREATE POLICY "Service role manages outbox"
ON public.entity_outbox FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- 2. Unified entity update RPC
CREATE OR REPLACE FUNCTION public.update_entity(
  p_entity_type text,
  p_entity_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_allowed text[];
  v_key text;
  v_sets text[] := '{}';
  v_old jsonb;
  v_new jsonb;
  v_user_company uuid;
  v_row_company uuid;
  v_is_super boolean;
  v_changed text[] := '{}';
  v_lead_id uuid;
  v_sched_date date;
  v_sched_time time;
  v_agent uuid;
  v_existing_sched record;
  v_duration interval := interval '2 hours';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  CASE p_entity_type
    WHEN 'lead' THEN
      v_table := 'leads';
      v_allowed := ARRAY['customer_name','customer_phone','customer_email','customer_address',
                         'service_type','status','priority','notes','assigned_agent_id',
                         'scheduled_date','scheduled_time','order_status','parts_status',
                         'estimated_duration_minutes','customer_id','equipment_id'];
    WHEN 'job' THEN
      v_table := 'jobs';
      v_allowed := ARRAY['title','description','address','status','priority','job_type',
                         'scheduled_for','estimated_duration','customer_id','location_id','invoice_id'];
    WHEN 'client' THEN
      v_table := 'customers';
      v_allowed := ARRAY['name','first_name','last_name','company_name','email','phone',
                         'secondary_phone','address','primary_address_line1','primary_address_line2',
                         'city','postal_code','area','notes','status','vat_number',
                         'preferred_contact_method','notification_opt_in'];
    ELSE
      RAISE EXCEPTION 'Unsupported entity type: %', p_entity_type;
  END CASE;

  SELECT company_id INTO v_user_company FROM public.profiles WHERE id = auth.uid();
  v_is_super := public.has_role(auth.uid(), 'platform_super_admin');

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', v_table)
    INTO v_old USING p_entity_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Record not found';
  END IF;

  v_row_company := NULLIF(v_old->>'company_id','')::uuid;
  IF NOT v_is_super AND v_row_company IS DISTINCT FROM v_user_company THEN
    RAISE EXCEPTION 'Record not found';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Field % is not editable on %', v_key, p_entity_type;
    END IF;
    IF (v_old->v_key) IS DISTINCT FROM (p_patch->v_key) THEN
      v_changed := array_append(v_changed, v_key);
      v_sets := array_append(
        v_sets,
        format('%I = ($1->>%L)::text::%s', v_key, v_key,
               (SELECT data_type FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v_table AND column_name=v_key))
      );
    END IF;
  END LOOP;

  IF array_length(v_sets,1) IS NULL THEN
    RETURN v_old;
  END IF;

  EXECUTE format('UPDATE public.%I SET %s WHERE id = $2 RETURNING to_jsonb(%I)',
                 v_table, array_to_string(v_sets, ', '), v_table)
    INTO v_new USING p_patch, p_entity_id;

  -- 3. Keep job_schedules authoritative for lead scheduling
  IF p_entity_type = 'lead'
     AND (v_changed && ARRAY['scheduled_date','scheduled_time','assigned_agent_id']) THEN
    v_lead_id := p_entity_id;
    v_sched_date := NULLIF(v_new->>'scheduled_date','')::date;
    v_sched_time := NULLIF(v_new->>'scheduled_time','')::time;
    v_agent := NULLIF(v_new->>'assigned_agent_id','')::uuid;

    SELECT * INTO v_existing_sched FROM public.job_schedules WHERE lead_id = v_lead_id
      ORDER BY created_at DESC LIMIT 1;

    IF v_existing_sched.id IS NOT NULL THEN
      IF v_existing_sched.start_time IS NOT NULL AND v_existing_sched.end_time IS NOT NULL THEN
        v_duration := v_existing_sched.end_time - v_existing_sched.start_time;
      END IF;
      IF v_sched_date IS NULL AND v_agent IS NULL THEN
        DELETE FROM public.job_schedules WHERE id = v_existing_sched.id;
      ELSE
        UPDATE public.job_schedules
        SET scheduled_date = COALESCE(v_sched_date, v_existing_sched.scheduled_date),
            start_time = COALESCE(v_sched_time, v_existing_sched.start_time),
            end_time = COALESCE(v_sched_time, v_existing_sched.start_time) + v_duration,
            agent_id = COALESCE(v_agent, v_existing_sched.agent_id),
            updated_at = now()
        WHERE id = v_existing_sched.id;
      END IF;
    ELSIF v_sched_date IS NOT NULL AND v_agent IS NOT NULL THEN
      INSERT INTO public.job_schedules (lead_id, agent_id, scheduled_date, start_time, end_time)
      VALUES (v_lead_id, v_agent, v_sched_date,
              COALESCE(v_sched_time, '08:00'::time),
              COALESCE(v_sched_time, '08:00'::time) + v_duration);
    END IF;
  END IF;

  -- 4. Audit log
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES (v_table, p_entity_id, 'UPDATE', v_old, v_new, auth.uid(), COALESCE(v_row_company, v_user_company));

  -- 5. Outbox events
  INSERT INTO public.entity_outbox (company_id, entity_type, entity_id, event_type, payload)
  VALUES (COALESCE(v_row_company, v_user_company), p_entity_type, p_entity_id, 'entity_updated',
          jsonb_build_object('changed', to_jsonb(v_changed), 'old', v_old, 'new', v_new,
                             'actor', auth.uid()));

  IF p_entity_type = 'lead'
     AND (v_changed && ARRAY['scheduled_date','scheduled_time','assigned_agent_id','status']) THEN
    INSERT INTO public.entity_outbox (company_id, entity_type, entity_id, event_type, payload)
    VALUES (COALESCE(v_row_company, v_user_company), p_entity_type, p_entity_id, 'notify_customer',
            jsonb_build_object('changed', to_jsonb(v_changed), 'old', v_old, 'new', v_new));
  END IF;

  IF (p_entity_type = 'job' AND 'status' = ANY(v_changed) AND v_new->>'status' = 'completed')
     OR (p_entity_type = 'lead' AND 'status' = ANY(v_changed) AND v_new->>'status' IN ('completed','cancelled')) THEN
    INSERT INTO public.entity_outbox (company_id, entity_type, entity_id, event_type, payload)
    VALUES (COALESCE(v_row_company, v_user_company), p_entity_type, p_entity_id, 'recalc_invoice',
            jsonb_build_object('status', v_new->>'status'));
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.update_entity(text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_entity(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_entity(text, uuid, jsonb) TO service_role;

-- 6. Realtime for cross-tab cache freshness
ALTER TABLE public.leads REPLICA IDENTITY FULL;
ALTER TABLE public.jobs REPLICA IDENTITY FULL;
ALTER TABLE public.customers REPLICA IDENTITY FULL;
ALTER TABLE public.job_schedules REPLICA IDENTITY FULL;