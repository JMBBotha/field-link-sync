-- Rollback: House 24 Avec tripping lead c0b3e9da-a2d7-4c39-b226-691cb83e4e4b closed 2026-10-12 ~18:40 SAST
-- Backup: backup_house24_20261012.leads (full row before change)
begin;
update public.leads l set status=b.status, lead_status=b.lead_status, cancellation_reason=b.cancellation_reason,
  needs_manual_assignment=b.needs_manual_assignment, call_next_action=b.call_next_action, notes=b.notes
from backup_house24_20261012.leads b where l.id=b.id;
commit;

-- Rollback: Cape Estates customer note appended 2026-10-12 ~18:40 SAST (backup: backup_house24_20261012.customers)
update public.customers c set notes=b.notes from backup_house24_20261012.customers b where c.id=b.id;
-- Rollback: House 24 site created 2026-10-12 ~18:41 SAST
delete from public.client_sites where id='db11d375-b836-407c-a95b-fc733b0d2396';

-- ===== Rollback: resolved_before_visit status (2026-10-12 ~18:45 SAST) =====
-- 1) move House 24 back to cancelled (backup_house24_20261012.leads_before_rbv)
begin;
update public.leads l set status=b.status, lead_status=b.lead_status from backup_house24_20261012.leads_before_rbv b where l.id=b.id;
update public.leads set status='cancelled' where status='resolved_before_visit';
update public.leads set lead_status='cancelled' where lead_status='resolved_before_visit';
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'converted'::text, 'qualified'::text, 'won'::text])));
commit;
-- 2) restore the 4 functions to pre-change definitions
CREATE OR REPLACE FUNCTION public._person_bookings(p_profile_id uuid, p_date date)
 RETURNS TABLE(start_time time without time zone, end_time time without time zone, customer_name text, job_id uuid, lead_id uuid, agent_id uuid, schedule_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.start_time,
         COALESCE(s.end_time, (s.start_time + make_interval(mins => public.default_booking_minutes(COALESCE(j.job_type, l.service_type, l.primary_intent::text))))::time),
         COALESCE(l.customer_name, j.title), s.job_id, s.lead_id, s.agent_id, s.id
  FROM public.job_schedules s
  LEFT JOIN public.jobs j ON j.id = s.job_id
  LEFT JOIN public.leads l ON l.id = s.lead_id
  WHERE s.agent_id = p_profile_id AND s.scheduled_date = p_date AND s.start_time IS NOT NULL
    AND lower(coalesce(j.status,'')) NOT IN ('cancelled','canceled','completed')
    AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled')
    AND l.deleted_at IS NULL
    -- lead-level row hidden when a job row exists for the same lead/person/day
    AND NOT (s.job_id IS NULL AND EXISTS (SELECT 1 FROM public.job_schedules s2
             WHERE s2.job_id IS NOT NULL AND s2.lead_id = s.lead_id AND s2.agent_id = s.agent_id AND s2.scheduled_date = s.scheduled_date))
  UNION ALL
  SELECT l.scheduled_time,
         (l.scheduled_time + make_interval(mins => COALESCE(l.estimated_duration_minutes, 60)))::time,
         l.customer_name, NULL::uuid, l.id, l.assigned_agent_id, NULL::uuid
  FROM public.leads l
  WHERE l.assigned_agent_id = p_profile_id AND l.scheduled_date = p_date AND l.scheduled_time IS NOT NULL
    AND l.deleted_at IS NULL AND lower(coalesce(l.status,'')) NOT IN ('cancelled','canceled')
    AND NOT EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = l.id)
  UNION ALL
  SELECT (GREATEST(b.starts_at, (p_date::timestamp) AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')::time,
         CASE WHEN b.ends_at >= ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg') THEN time '23:59:59'
              ELSE (b.ends_at AT TIME ZONE 'Africa/Johannesburg')::time END,
         CASE WHEN b.kind = 'leave' THEN 'Off' ELSE 'Blocked' END,
         NULL::uuid, NULL::uuid, b.profile_id, NULL::uuid
  FROM public.staff_blocked_time b
  WHERE b.profile_id = p_profile_id AND b.archived_at IS NULL
    AND b.starts_at < ((p_date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg')
    AND b.ends_at > ((p_date::timestamp) AT TIME ZONE 'Africa/Johannesburg');
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_appointments(p_days integer DEFAULT 60)
 RETURNS TABLE(lead_id uuid, scheduled_date date, scheduled_time time without time zone, customer_name text, address text, service_type text, status text, is_mine boolean, source text, quote_id uuid, customer_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
  s AS (
    SELECT l.id AS lead_id, l.scheduled_date AS d, l.scheduled_time AS t,
           (l.assigned_agent_id IS NOT DISTINCT FROM auth.uid()) AS mine, 'lead'::text AS src
      FROM public.leads l, today
     WHERE l.scheduled_date BETWEEN today.d AND today.d + GREATEST(COALESCE(p_days, 60), 0)
       AND (l.assigned_agent_id = auth.uid() OR (l.assigned_agent_id IS NULL AND l.status = 'pending' /*p1lane*/ AND (NOT public.is_sales_rep(auth.uid()) OR (COALESCE(l.primary_intent::text, 'sales') = 'sales' /*lf*/ AND EXISTS (SELECT 1 FROM public.rep_offerable_leads() o WHERE o.lead_id = l.id)))))
    UNION ALL
    SELECT js.lead_id, js.scheduled_date, js.start_time, true, 'schedule'
      FROM public.job_schedules js, today
     WHERE js.agent_id = auth.uid() AND js.lead_id IS NOT NULL
       AND js.scheduled_date BETWEEN today.d AND today.d + GREATEST(COALESCE(p_days, 60), 0)
  ),
  picked AS (
    SELECT DISTINCT ON (s.lead_id, s.d) s.* FROM s ORDER BY s.lead_id, s.d, s.mine DESC, s.src
  )
  SELECT l.id, p.d, p.t, l.customer_name, COALESCE(NULLIF(l.customer_address, ''), l.normalized_address),
         l.service_type, l.status, p.mine, p.src,
         (SELECT q.id FROM public.quotes q WHERE q.lead_id = l.id ORDER BY q.created_at DESC LIMIT 1),
         l.customer_id
    FROM picked p JOIN public.leads l ON l.id = p.lead_id
   WHERE COALESCE(l.status, '') NOT IN ('cancelled', 'completed', 'converted')
     AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
     AND l.company_id = public.get_user_company_id(auth.uid())
   ORDER BY p.d, p.t NULLS LAST, l.customer_name;
$function$
;

CREATE OR REPLACE FUNCTION public.link_quote_to_open_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT l.id INTO NEW.lead_id FROM public.leads l
     WHERE l.customer_id = NEW.customer_id AND l.deleted_at IS NULL
       AND (NEW.company_id IS NULL OR l.company_id = NEW.company_id)
       AND l.status NOT IN ('completed','cancelled')
       AND l.created_at > now() - interval '60 days'
     ORDER BY l.created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.update_entity(p_entity_type text, p_entity_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      v_allowed := ARRAY['customer_name','customer_phone','email','customer_address',
                         'service_type','status','priority','notes','assigned_agent_id',
                         'scheduled_date','scheduled_time','order_status','parts_status',
                         'estimated_duration_minutes','customer_id','equipment_id','latitude','longitude'];
    WHEN 'job' THEN
      v_table := 'jobs';
      v_allowed := ARRAY['title','description','address','status','priority','job_type',
                         'scheduled_for','estimated_duration','customer_id','location_id','invoice_id','lat','lng'];
    WHEN 'client' THEN
      v_table := 'customers';
      v_allowed := ARRAY['name','first_name','last_name','company_name','email','phone',
                         'secondary_phone','address','primary_address_line1','primary_address_line2',
                         'city','postal_code','area','notes','status','vat_number',
                         'preferred_contact_method','notification_opt_in','latitude','longitude'];
    WHEN 'project' THEN
      v_table := 'fb_projects';
      v_allowed := ARRAY['name','status','budget','client_id'];
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

  -- Calendar rows now follow leads via trigger trg_sync_lead_schedule (old block removed: it could move the install row).

  -- Lead address -> its client (only fills blank/placeholder or the same old value)
  IF p_entity_type = 'lead' AND 'customer_address' = ANY(v_changed)
     AND NULLIF(v_new->>'customer_id','') IS NOT NULL AND NULLIF(v_new->>'customer_address','') IS NOT NULL THEN
    UPDATE public.customers c
       SET address = v_new->>'customer_address',
           primary_address_line1 = CASE WHEN NULLIF(c.primary_address_line1,'') IS NULL
                                          OR c.primary_address_line1 = v_old->>'customer_address'
                                          OR c.primary_address_line1 = c.address
                                        THEN v_new->>'customer_address' ELSE c.primary_address_line1 END,
           latitude  = CASE WHEN 'latitude'  = ANY(v_changed) THEN (v_new->>'latitude')::numeric  ELSE c.latitude  END,
           longitude = CASE WHEN 'longitude' = ANY(v_changed) THEN (v_new->>'longitude')::numeric ELSE c.longitude END
     WHERE c.id = (v_new->>'customer_id')::uuid
       AND (NULLIF(c.address,'') IS NULL OR c.address = v_old->>'customer_address' OR c.address ~* '^address (pending|to be confirmed)');
  END IF;

  -- Client card address parts -> composite customers.address (read by quotes, emails, Stages)
  IF p_entity_type = 'client'
     AND (v_changed && ARRAY['primary_address_line1','primary_address_line2','city','postal_code'])
     AND NOT ('address' = ANY(v_changed))
     AND NULLIF(v_new->>'primary_address_line1','') IS NOT NULL THEN
    UPDATE public.customers
       SET address = concat_ws(', ', NULLIF(v_new->>'primary_address_line1',''), NULLIF(v_new->>'primary_address_line2',''),
                                     NULLIF(v_new->>'city',''), NULLIF(v_new->>'postal_code',''))
     WHERE id = p_entity_id
     RETURNING to_jsonb(customers) INTO v_new;
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES (v_table, p_entity_id, 'update', v_old, v_new, auth.uid(), COALESCE(v_row_company, v_user_company));

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

  -- Bell notification for the team on meaningful changes
  IF v_changed && ARRAY['scheduled_date','scheduled_time','scheduled_for','assigned_agent_id','status','priority'] THEN
    INSERT INTO public.entity_outbox (company_id, entity_type, entity_id, event_type, payload)
    VALUES (COALESCE(v_row_company, v_user_company), p_entity_type, p_entity_id, 'notify_team',
            jsonb_build_object('changed', to_jsonb(v_changed), 'old', v_old, 'new', v_new,
                               'actor', auth.uid()));
  END IF;

  IF (p_entity_type = 'job' AND 'status' = ANY(v_changed) AND v_new->>'status' = 'completed')
     OR (p_entity_type = 'lead' AND 'status' = ANY(v_changed) AND v_new->>'status' IN ('completed','cancelled')) THEN
    INSERT INTO public.entity_outbox (company_id, entity_type, entity_id, event_type, payload)
    VALUES (COALESCE(v_row_company, v_user_company), p_entity_type, p_entity_id, 'recalc_invoice',
            jsonb_build_object('status', v_new->>'status'));
  END IF;

  RETURN v_new;
END;
$function$
;
-- 3) enum value 'resolved_before_visit' on lead_lifecycle_status cannot be dropped in Postgres; it is harmless once unused.
-- 4) app: git revert <commit> and redeploy
