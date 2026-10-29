-- Johan 29 Oct 18:41: a salesperson who accepts or is allocated a client becomes that client's default rep; no duplicated/mixed allocation.
-- owner_rep_id is the ONE rep field. assigned_rep_id is kept only as a mirror of owner_rep_id (0 rows had it set; no conflicts).

-- 1) Lead assigned to / accepted by a SALES REP (not techs): fill an empty owner rep; never overwrite a different one -> flag for admin.
CREATE OR REPLACE FUNCTION public.trg_lead_default_owner_rep()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.customers%ROWTYPE; v_src text; v_req uuid;
BEGIN
  IF NEW.assigned_agent_id IS NULL OR NEW.customer_id IS NULL OR NOT public.is_sales_rep(NEW.assigned_agent_id) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.customers WHERE id = NEW.customer_id AND company_id = NEW.company_id FOR UPDATE;
  IF c.id IS NULL OR c.owner_rep_id = NEW.assigned_agent_id THEN RETURN NULL; END IF;
  v_src := CASE WHEN auth.uid() = NEW.assigned_agent_id THEN 'accepted' ELSE 'assigned' END;
  SELECT id INTO v_req FROM public.requests WHERE lead_id = NEW.id ORDER BY created_at DESC LIMIT 1;
  IF v_req IS NULL THEN SELECT id INTO v_req FROM public.requests WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1; END IF;
  IF c.owner_rep_id IS NULL THEN
    PERFORM set_config('fl.owner_rep_auto','1',true);
    UPDATE public.customers SET owner_rep_id = NEW.assigned_agent_id, owner_rep_set_at = now(), owner_rep_source = v_src WHERE id = c.id;
    PERFORM set_config('fl.owner_rep_auto','',true);
    IF v_req IS NOT NULL THEN PERFORM public._req_event(v_req, 'owner_rep_set', NULL, NEW.assigned_agent_id::text, 'Default rep from lead ' || v_src); END IF;
  ELSE
    -- keep the existing rep; admin decides via set_customer_owner_rep (no push/notification)
    IF v_req IS NOT NULL THEN PERFORM public._req_event(v_req, 'owner_rep_conflict', c.owner_rep_id::text, NEW.assigned_agent_id::text, 'Lead ' || v_src || ' by another rep; client rep kept - admin to decide'); END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_zz_lead_default_owner_rep ON public.leads;
CREATE TRIGGER trg_zz_lead_default_owner_rep AFTER INSERT OR UPDATE OF assigned_agent_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_default_owner_rep();

-- 2) One rep field: owner_rep_id is the truth, assigned_rep_id mirrors it.
CREATE OR REPLACE FUNCTION public.customers_rep_owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rep boolean := v_uid IS NOT NULL AND public.is_sales_rep(v_uid);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.created_by := CASE WHEN v_rep THEN v_uid ELSE COALESCE(NEW.created_by, v_uid) END;
    END IF;
    IF v_rep AND NEW.owner_rep_id IS NULL THEN
      NEW.owner_rep_id := v_uid; NEW.owner_rep_set_at := now(); NEW.owner_rep_source := 'created';
    END IF;
    IF NEW.owner_rep_id IS NULL AND NEW.assigned_rep_id IS NOT NULL THEN
      NEW.owner_rep_id := NEW.assigned_rep_id; NEW.owner_rep_set_at := now(); NEW.owner_rep_source := 'assigned';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_rep AND COALESCE(current_setting('fl.owner_rep_auto', true),'') <> '1' THEN
      NEW.owner_rep_id := OLD.owner_rep_id; NEW.owner_rep_set_at := OLD.owner_rep_set_at; NEW.owner_rep_source := OLD.owner_rep_source;
      NEW.created_by := OLD.created_by;
    ELSIF NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id AND NEW.owner_rep_id IS NOT DISTINCT FROM OLD.owner_rep_id AND OLD.owner_rep_id IS NULL THEN
      -- legacy writer set assigned_rep_id on an unowned client: treat as owner
      NEW.owner_rep_id := NEW.assigned_rep_id; NEW.owner_rep_set_at := now(); NEW.owner_rep_source := 'assigned';
    END IF;
  END IF;
  NEW.assigned_rep_id := NEW.owner_rep_id;  -- mirror, never diverges
  RETURN NEW;
END;
$function$;
UPDATE public.customers SET assigned_rep_id = owner_rep_id WHERE assigned_rep_id IS DISTINCT FROM owner_rep_id;

-- 3) Rep client visibility uses the same rule.
CREATE OR REPLACE FUNCTION public.rep_can_see_customer(_uid uuid, _customer uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND _customer IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer AND (c.owner_rep_id = _uid OR c.assigned_rep_id = _uid OR c.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.customer_id = _customer AND l.deleted_at IS NULL
                 AND (l.assigned_agent_id = _uid OR l.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.leads l JOIN public.offers o ON o.lead_id = l.id
                WHERE l.customer_id = _customer AND l.deleted_at IS NULL AND o.staff_id = _uid AND o.status = 'accepted')
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.customer_id = _customer
                 AND _uid IN (q.sales_engineer_id, q.owner_id, q.created_by))
    OR EXISTS (SELECT 1 FROM public.quotes q JOIN public.leads l ON l.id = q.lead_id
                WHERE q.customer_id = _customer AND (l.assigned_agent_id = _uid OR l.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.customer_id = _customer AND i.agent_id = _uid)
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.customer_id = _customer
                 AND (j.created_by = _uid OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = j.id AND a.profile_id = _uid)))
  );
$function$;
