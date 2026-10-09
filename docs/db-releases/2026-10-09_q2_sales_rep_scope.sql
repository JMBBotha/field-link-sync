-- Q2 (2026-10-09): sales reps see only their own quotes/jobs/customers; admins see everything.
-- Table RLS (rh_rep_scope on quotes, jobs, leads, customers, invoices, payments, equipment, ...) already scopes reps.
-- Gap closed here: get_quotes_for_lead (SECURITY DEFINER) returned every quote on any company lead, incl. totals
-- and public tokens. Now mirrors the quotes rh_rep_scope rule for reps. Idempotent.
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_quotes_for_lead(uuid)'::regprocedure);
  IF position('/*rh2*/' in d) = 0 THEN
    d := replace(d, 'WHERE q.lead_id = p_lead_id',
      'WHERE q.lead_id = p_lead_id AND (NOT public.is_sales_rep(auth.uid()) OR auth.uid() IN (q.sales_engineer_id, q.owner_id, q.created_by) OR EXISTS (SELECT 1 FROM public.leads l2 WHERE l2.id = q.lead_id AND auth.uid() IN (l2.created_by, l2.assigned_agent_id))) /*rh2*/');
    IF position('/*rh2*/' in d) = 0 THEN RAISE EXCEPTION 'anchor not found'; END IF;
    EXECUTE d;
  END IF;
END $$;
