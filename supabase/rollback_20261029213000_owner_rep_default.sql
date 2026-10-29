-- rollback 20261029213000_owner_rep_default
DROP TRIGGER IF EXISTS trg_zz_lead_default_owner_rep ON public.leads;
DROP FUNCTION IF EXISTS public.trg_lead_default_owner_rep();
CREATE OR REPLACE FUNCTION public.customers_rep_owner_guard()
 RETURNS trigger
 LANGUAGE plpgsql
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
    IF v_rep THEN
      NEW.assigned_rep_id := v_uid;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_rep THEN
      NEW.assigned_rep_id := OLD.assigned_rep_id;
      NEW.created_by      := OLD.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rep_can_see_customer(_uid uuid, _customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND _customer IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.customers c WHERE c.id = _customer AND (c.assigned_rep_id = _uid OR c.created_by = _uid))
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

