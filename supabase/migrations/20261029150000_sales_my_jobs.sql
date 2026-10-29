-- Sales "My jobs": a rep follows leads they own (created/accepted), quoted, or assigned via Assign.
CREATE OR REPLACE FUNCTION public.rep_follows_lead(_uid uuid, _lead uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _lead IS NOT NULL AND (
    public.rep_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = _uid));
$$;
REVOKE ALL ON FUNCTION public.rep_follows_lead(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rep_follows_lead(uuid, uuid) TO authenticated;

-- Keep read access to leads a rep assigned or quoted (owner too). Restrictive company scope still applies.
CREATE OR REPLACE FUNCTION public.rep_can_see_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND ((l.status = 'pending' AND l.assigned_agent_id IS NULL) OR l.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid)
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = _lead AND (q.sales_engineer_id = _uid OR q.created_by = _uid OR q.owner_id = _uid))
    OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = _uid);
$function$;

CREATE OR REPLACE FUNCTION public._job_stage(j public.jobs, l public.leads)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN j.completed_at IS NOT NULL OR j.status IN ('completed','invoiced','closed') OR (j.id IS NULL AND l.status = 'completed') THEN 'completed'
    WHEN j.started_at IS NOT NULL OR j.status = 'in_progress' OR (j.id IS NULL AND (l.started_at IS NOT NULL OR l.status = 'in_progress')) THEN 'on_site'
    WHEN j.en_route_at IS NOT NULL THEN 'en_route'
    ELSE 'assigned' END;
$$;

-- Caller's own followed jobs only. Tech: name + availability only (no location/phone). No money fields.
CREATE OR REPLACE FUNCTION public.sales_my_jobs(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_co uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_co := public.get_user_company_id(v_uid);
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'sort') DESC) FROM (
      SELECT jsonb_build_object(
        'lead_id', l.id, 'job_id', j.id, 'customer', l.customer_name,
        'title', COALESCE(j.title, l.service_type),
        'tech_name', p.full_name, 'tech_status', COALESCE(p.availability_status, 'offline'),
        'scheduled_date', COALESCE((j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date, l.scheduled_date),
        'scheduled_time', COALESCE(to_char(j.scheduled_for AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'), left(l.scheduled_time::text, 5)),
        'stage', public._job_stage(j, l), 'job_status', COALESCE(j.status::text, l.status),
        'job_types', l.job_types, 'job_info', l.job_info,
        'photos', (SELECT count(*) FROM public.job_photos ph WHERE ph.lead_id = l.id),
        'sort', COALESCE(j.updated_at, l.created_at)) x
      FROM public.leads l
      LEFT JOIN LATERAL (SELECT * FROM public.jobs jj WHERE jj.lead_id = l.id ORDER BY jj.created_at DESC LIMIT 1) j ON true
      LEFT JOIN public.profiles p ON p.id = COALESCE((SELECT s.agent_id FROM public.job_schedules s WHERE s.job_id = j.id ORDER BY s.created_at DESC LIMIT 1), l.assigned_agent_id)
      WHERE l.company_id = v_co AND l.deleted_at IS NULL
        AND (l.assigned_agent_id IS NOT NULL OR j.id IS NOT NULL)
        AND COALESCE(l.assigned_agent_id, '00000000-0000-0000-0000-000000000000') <> v_uid
        AND public.rep_follows_lead(v_uid, l.id)
      ORDER BY COALESCE(j.updated_at, l.created_at) DESC
      LIMIT LEAST(GREATEST(p_limit, 1), 200)) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.sales_my_jobs(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sales_my_jobs(int) TO authenticated;

-- In-app notification to following sales reps on stage change (assigned/en route/on site/completed).
CREATE OR REPLACE FUNCTION public._notify_rep_followers(p_lead uuid, p_stage text, p_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.leads%ROWTYPE; r uuid; v_label text;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = p_lead;
  IF l.id IS NULL THEN RETURN; END IF;
  v_label := CASE p_stage WHEN 'assigned' THEN 'Technician assigned' WHEN 'en_route' THEN 'Technician en route'
    WHEN 'on_site' THEN 'Technician on site' WHEN 'completed' THEN 'Job completed' END;
  FOR r IN
    SELECT DISTINCT u FROM (
      SELECT l.created_by u UNION SELECT l.assigned_agent_id
      UNION SELECT unnest(ARRAY[q.sales_engineer_id, q.owner_id, q.created_by]) FROM public.quotes q WHERE q.lead_id = p_lead
      UNION SELECT g.assigned_by FROM public.lead_assignment_log g WHERE g.lead_id = p_lead) s
    WHERE u IS NOT NULL AND u IS DISTINCT FROM auth.uid() AND public.is_sales_rep(u)
      AND public.get_user_company_id(u) = l.company_id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = r AND n.type = 'sales_job_stage'
                   AND n.related_id = p_lead AND n.metadata->>'stage' = p_stage AND n.created_at > now() - interval '10 minutes') THEN
      INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
      VALUES (r, 'sales_job_stage', v_label, COALESCE(l.customer_name, 'Your job'), p_lead,
              jsonb_build_object('stage', p_stage, 'lead_id', p_lead, 'job_id', p_job));
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._notify_rep_followers(uuid, text, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_jobs_notify_rep() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s_new text; s_old text; l public.leads%ROWTYPE;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO l FROM public.leads WHERE id = NEW.lead_id;
  s_new := public._job_stage(NEW, l); s_old := public._job_stage(OLD, l);
  IF s_new <> s_old THEN PERFORM public._notify_rep_followers(NEW.lead_id, s_new, NEW.id); END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW; -- never block job updates
END $$;
DROP TRIGGER IF EXISTS jobs_notify_rep ON public.jobs;
CREATE TRIGGER jobs_notify_rep AFTER UPDATE OF status, en_route_at, started_at, completed_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_jobs_notify_rep();

CREATE OR REPLACE FUNCTION public.trg_leads_notify_rep() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s_new text; s_old text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.lead_id = NEW.id) THEN RETURN NEW; END IF; -- job trigger handles it
  IF NEW.assigned_agent_id IS NOT NULL AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
     AND public.is_sales_rep(NEW.assigned_agent_id) THEN RETURN NEW; END IF; -- rep took the lead themselves
  s_new := CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE public._job_stage(NULL::public.jobs, NEW) END;
  s_old := CASE WHEN OLD.assigned_agent_id IS NULL THEN NULL ELSE public._job_stage(NULL::public.jobs, OLD) END;
  IF s_new IS NOT NULL AND (s_new IS DISTINCT FROM s_old OR NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id) THEN
    PERFORM public._notify_rep_followers(NEW.id, s_new, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_notify_rep ON public.leads;
CREATE TRIGGER leads_notify_rep AFTER UPDATE OF status, assigned_agent_id, started_at ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_leads_notify_rep();
