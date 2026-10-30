-- Rollback for 20261030120000_rep_scope_lock.sql
BEGIN;
DROP TRIGGER IF EXISTS trg_customers_owner_rep_log ON public.customers;
DROP FUNCTION IF EXISTS public.customers_owner_rep_log();
DROP POLICY IF EXISTS rh_rep_scope ON public.quotes;
CREATE POLICY rh_rep_scope ON public.quotes AS RESTRICTIVE FOR SELECT TO authenticated USING ((NOT ( SELECT is_sales_rep(auth.uid()) AS is_sales_rep)) OR (sales_engineer_id = auth.uid()) OR (owner_id = auth.uid()) OR (created_by = auth.uid()) OR ((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM leads l WHERE ((l.id = quotes.lead_id) AND ((l.created_by = auth.uid()) OR (l.assigned_agent_id = auth.uid())))))));
CREATE OR REPLACE FUNCTION public.customers_rep_owner_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fl_rep_owns_customer(_uid uuid, _customer uuid, _company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND _customer IS NOT NULL AND public.is_sales_rep(_uid)
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer AND c.owner_rep_id = _uid
                AND c.company_id = _company AND c.company_id = public.get_user_company_id(_uid));
$function$
;

CREATE OR REPLACE FUNCTION public.rep_can_see_customer(_uid uuid, _customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
;

CREATE OR REPLACE FUNCTION public.rep_can_see_invoice(_uid uuid, _inv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = _inv AND (
      i.agent_id = _uid
      OR EXISTS (SELECT 1 FROM public.quotes q WHERE _uid IN (q.sales_engineer_id, q.created_by, q.owner_id)
                 AND (q.id = i.quote_id
                      OR (i.customer_id IS NOT NULL AND q.customer_id = i.customer_id)
                      OR (i.lead_id IS NOT NULL AND q.lead_id = i.lead_id)
                      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.invoice_id = i.id AND j.quote_id = q.id)))));
$function$
;

CREATE OR REPLACE FUNCTION public.rep_can_see_lead(_uid uuid, _lead uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND ((l.status = 'pending' AND l.assigned_agent_id IS NULL) OR l.created_by = _uid))
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid)
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = _lead AND (q.sales_engineer_id = _uid OR q.created_by = _uid OR q.owner_id = _uid))
    OR EXISTS (SELECT 1 FROM public.lead_assignment_log g WHERE g.lead_id = _lead AND g.assigned_by = _uid);
$function$
;

CREATE OR REPLACE FUNCTION public.set_customer_owner_rep(p_customer_id uuid, p_rep_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.customers%ROWTYPE; v_req uuid;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF c.id IS NULL OR NOT public.fl_is_company_office(auth.uid(), c.company_id) OR public.is_sales_rep(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only admin can change the client''s rep');
  END IF;
  IF p_rep_id IS NOT NULL AND NOT public._rep_is_active(p_rep_id, c.company_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick an active salesperson in this company'); END IF;
  IF COALESCE(trim(p_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Pick a reason'); END IF;
  UPDATE public.customers SET owner_rep_id = p_rep_id, owner_rep_set_at = now(), owner_rep_source = 'admin' WHERE id = c.id;
  -- log against the client's latest request (or a closed audit-only request row if none)
  SELECT id INTO v_req FROM public.requests WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1;
  IF v_req IS NULL THEN
    INSERT INTO public.requests (company_id, source, status, customer_id, customer_name, created_by, summary)
    VALUES (c.company_id, 'audit', 'archived', c.id, c.name, auth.uid(), 'Owner rep change') RETURNING id INTO v_req;
  END IF;
  PERFORM public._req_event(v_req, 'owner_rep_changed', c.owner_rep_id::text, p_rep_id::text, p_reason);
  -- open move requests follow the new rep
  UPDATE public.requests SET assigned_to = p_rep_id, assigned_at = now(), routed_to = 'owner_rep', updated_at = now()
   WHERE customer_id = c.id AND type = 'move' AND status = 'open' AND routed_to = 'owner_rep';
  IF c.owner_rep_id IS NOT NULL AND c.owner_rep_id IS DISTINCT FROM p_rep_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (c.owner_rep_id, 'owner_rep_reassigned', 'Client reassigned', COALESCE(c.name,'A client') || ' was reassigned.', c.id, jsonb_build_object('customer_id', c.id));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$
;
DROP FUNCTION IF EXISTS public.set_rep_linked_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.fl_is_company_admin(uuid, uuid);
-- keep audit history; drop only if you really want it gone:
-- DROP TABLE public.customer_owner_rep_log; 
DROP TABLE IF EXISTS public.rep_linked_admin;
COMMIT;
-- Note: rollback leaves customer_owner_rep_log (history). Revert code commit: git revert <merge>.
