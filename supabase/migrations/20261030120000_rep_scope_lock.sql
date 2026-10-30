-- 1) Linked sales login: a sales rep linked (by an admin) to an admin of the SAME company also sees
--    clients with no rep or owned by that admin. Everything else about the rep (role, screens, RLS) unchanged.
-- 2) Lock: only a company admin may change customers.owner_rep_id / assigned_rep_id. System default
--    (fill an EMPTY rep on accept/assign) still works and never overwrites. Every change is logged.

CREATE TABLE IF NOT EXISTS public.rep_linked_admin (
  rep_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  set_by uuid, set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rep_linked_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rep_linked_admin FROM anon, authenticated;
-- no policies: only SECURITY DEFINER functions read/write it

CREATE TABLE IF NOT EXISTS public.customer_owner_rep_log (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL, company_id uuid,
  from_rep uuid, to_rep uuid, changed_by uuid, source text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_owner_rep_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_owner_rep_log FROM anon;
DROP POLICY IF EXISTS corl_admin_read ON public.customer_owner_rep_log;
CREATE POLICY corl_admin_read ON public.customer_owner_rep_log FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role) AND NOT public.is_sales_rep(auth.uid()));

CREATE OR REPLACE FUNCTION public.fl_is_company_admin(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _company IS NOT NULL AND NOT public.is_sales_rep(_uid)
    AND public.get_user_company_id(_uid) = _company
    AND (public.has_role(_uid,'admin'::app_role)
         OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=_company AND cm.role='admin'));
$$;

-- shared rep helper: owned by me, or (linked login) unowned / owned by my linked admin
CREATE OR REPLACE FUNCTION public.fl_rep_owns_customer(_uid uuid, _customer uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND _customer IS NOT NULL AND public.is_sales_rep(_uid)
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer
                AND c.company_id = _company AND c.company_id = public.get_user_company_id(_uid)
                AND (c.owner_rep_id = _uid
                     OR EXISTS (SELECT 1 FROM public.rep_linked_admin k
                                 WHERE k.rep_user_id = _uid AND k.company_id = c.company_id
                                   AND (c.owner_rep_id IS NULL OR c.owner_rep_id = k.admin_user_id)
                                   AND public.fl_is_company_admin(k.admin_user_id, c.company_id))));
$$;

CREATE OR REPLACE FUNCTION public.rep_can_see_customer(_uid uuid, _customer uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT _uid IS NOT NULL AND _customer IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer AND (c.owner_rep_id = _uid OR c.assigned_rep_id = _uid OR c.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer AND public.fl_rep_owns_customer(_uid, c.id, c.company_id))
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

-- leads / invoices / quotes of a client the rep follows (owner or linked scope)
CREATE OR REPLACE FUNCTION public.rep_can_see_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND ((l.status = 'pending' AND l.assigned_agent_id IS NULL) OR l.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid)
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = _lead AND (q.sales_engineer_id = _uid OR q.created_by = _uid OR q.owner_id = _uid))
    OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = _uid)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND public.fl_rep_owns_customer(_uid, l.customer_id, l.company_id));
$function$;

CREATE OR REPLACE FUNCTION public.rep_can_see_invoice(_uid uuid, _inv uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = _inv AND (
      i.agent_id = _uid
      OR public.fl_rep_owns_customer(_uid, i.customer_id, i.company_id)
      OR EXISTS (SELECT 1 FROM public.quotes q WHERE _uid IN (q.sales_engineer_id, q.created_by, q.owner_id)
                 AND (q.id = i.quote_id
                      OR (i.customer_id IS NOT NULL AND q.customer_id = i.customer_id)
                      OR (i.lead_id IS NOT NULL AND q.lead_id = i.lead_id)
                      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.invoice_id = i.id AND j.quote_id = q.id)))));
$function$;

DROP POLICY IF EXISTS rh_rep_scope ON public.quotes;
CREATE POLICY rh_rep_scope ON public.quotes AS RESTRICTIVE FOR SELECT TO authenticated USING (
  (NOT (SELECT public.is_sales_rep(auth.uid()))) OR sales_engineer_id = auth.uid() OR owner_id = auth.uid() OR created_by = auth.uid()
  OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = quotes.lead_id AND (l.created_by = auth.uid() OR l.assigned_agent_id = auth.uid())))
  OR (customer_id IS NOT NULL AND public.fl_rep_owns_customer(auth.uid(), customer_id, company_id)));

-- guard: only company admin changes an existing rep; system may only fill an empty rep
CREATE OR REPLACE FUNCTION public.customers_rep_owner_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rep boolean := v_uid IS NOT NULL AND public.is_sales_rep(v_uid);
  v_admin boolean;
  v_system boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.created_by := CASE WHEN v_rep THEN v_uid ELSE COALESCE(NEW.created_by, v_uid) END;
    END IF;
    IF v_rep THEN
      -- a rep creating a client becomes its rep; cannot create it for someone else
      NEW.owner_rep_id := v_uid; NEW.owner_rep_set_at := now(); NEW.owner_rep_source := 'created';
    ELSIF NEW.owner_rep_id IS NULL AND NEW.assigned_rep_id IS NOT NULL THEN
      NEW.owner_rep_id := NEW.assigned_rep_id; NEW.owner_rep_set_at := now(); NEW.owner_rep_source := 'assigned';
    END IF;
  ELSE
    IF v_rep THEN NEW.created_by := OLD.created_by; END IF;
    -- legacy writers set assigned_rep_id only
    IF NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id AND NEW.owner_rep_id IS NOT DISTINCT FROM OLD.owner_rep_id THEN
      NEW.owner_rep_id := NEW.assigned_rep_id;
    END IF;
    IF NEW.owner_rep_id IS DISTINCT FROM OLD.owner_rep_id THEN
      v_admin := v_uid IS NOT NULL AND public.fl_is_company_admin(v_uid, OLD.company_id);
      v_system := OLD.owner_rep_id IS NULL AND NEW.owner_rep_id IS NOT NULL
                  AND (COALESCE(current_setting('fl.owner_rep_auto', true),'') = '1' OR v_uid IS NULL OR pg_trigger_depth() > 1);
      IF NOT (v_admin OR v_system OR COALESCE(current_setting('fl.owner_rep_admin', true),'') = '1') THEN
        RAISE EXCEPTION 'Only an admin can change a client''s rep' USING ERRCODE = '42501';
      END IF;
      IF NEW.owner_rep_set_at IS NOT DISTINCT FROM OLD.owner_rep_set_at THEN NEW.owner_rep_set_at := now(); END IF;
      IF NEW.owner_rep_source IS NOT DISTINCT FROM OLD.owner_rep_source THEN
        NEW.owner_rep_source := CASE WHEN v_admin THEN 'admin' WHEN NEW.owner_rep_id IS NULL THEN NULL ELSE 'system' END;
      END IF;
    ELSE
      NEW.owner_rep_set_at := OLD.owner_rep_set_at; NEW.owner_rep_source := OLD.owner_rep_source;
    END IF;
  END IF;
  NEW.assigned_rep_id := NEW.owner_rep_id;  -- mirror, never diverges
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customers_owner_rep_log()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.owner_rep_id IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_rep_id IS NOT DISTINCT FROM OLD.owner_rep_id THEN RETURN NULL; END IF;
  INSERT INTO public.customer_owner_rep_log (customer_id, company_id, from_rep, to_rep, changed_by, source)
  VALUES (NEW.id, NEW.company_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.owner_rep_id END, NEW.owner_rep_id, auth.uid(),
          COALESCE(NEW.owner_rep_source, CASE WHEN NEW.owner_rep_id IS NULL THEN 'cleared' END));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_customers_owner_rep_log ON public.customers;
CREATE TRIGGER trg_customers_owner_rep_log AFTER INSERT OR UPDATE OF owner_rep_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_owner_rep_log();

-- admin RPC: strict admin only (office dispatchers no longer); clearing allowed
CREATE OR REPLACE FUNCTION public.set_customer_owner_rep(p_customer_id uuid, p_rep_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.customers%ROWTYPE; v_req uuid;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF c.id IS NULL OR NOT public.fl_is_company_admin(auth.uid(), c.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only admin can change the client''s rep');
  END IF;
  IF p_rep_id IS NOT NULL AND NOT public._rep_is_active(p_rep_id, c.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick an active salesperson in this company'); END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick a reason'); END IF;
  UPDATE public.customers SET owner_rep_id = p_rep_id, owner_rep_set_at = now(),
         owner_rep_source = CASE WHEN p_rep_id IS NULL THEN 'admin_cleared' ELSE 'admin' END WHERE id = c.id;
  SELECT id INTO v_req FROM public.requests WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1;
  IF v_req IS NULL THEN
    INSERT INTO public.requests (company_id, source, status, customer_id, customer_name, created_by, summary)
    VALUES (c.company_id, 'audit', 'archived', c.id, c.name, auth.uid(), 'Owner rep change') RETURNING id INTO v_req;
  END IF;
  PERFORM public._req_event(v_req, 'owner_rep_changed', c.owner_rep_id::text, p_rep_id::text, p_reason);
  UPDATE public.requests SET assigned_to = p_rep_id, assigned_at = now(), routed_to = 'owner_rep', updated_at = now()
   WHERE customer_id = c.id AND type = 'move' AND status = 'open' AND routed_to = 'owner_rep';
  IF c.owner_rep_id IS NOT NULL AND c.owner_rep_id IS DISTINCT FROM p_rep_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (c.owner_rep_id, 'owner_rep_reassigned', 'Client reassigned', COALESCE(c.name,'A client') || ' was reassigned.', c.id, jsonb_build_object('customer_id', c.id));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- admin RPC to link/unlink a sales login to an admin (same company)
CREATE OR REPLACE FUNCTION public.set_rep_linked_admin(p_rep uuid, p_admin uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid());
BEGIN
  IF NOT public.fl_is_company_admin(auth.uid(), v_co) THEN RETURN jsonb_build_object('ok', false, 'message', 'Admin only'); END IF;
  IF p_rep IS NULL OR public.get_user_company_id(p_rep) IS DISTINCT FROM v_co OR NOT public.is_sales_rep(p_rep) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Pick a salesperson in this company'); END IF;
  IF p_admin IS NULL THEN DELETE FROM public.rep_linked_admin WHERE rep_user_id = p_rep; RETURN jsonb_build_object('ok', true); END IF;
  IF NOT public.fl_is_company_admin(p_admin, v_co) THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick an admin in this company'); END IF;
  INSERT INTO public.rep_linked_admin (rep_user_id, admin_user_id, company_id, set_by) VALUES (p_rep, p_admin, v_co, auth.uid())
  ON CONFLICT (rep_user_id) DO UPDATE SET admin_user_id = EXCLUDED.admin_user_id, company_id = EXCLUDED.company_id, set_by = EXCLUDED.set_by, set_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.set_rep_linked_admin(uuid, uuid) FROM anon;
