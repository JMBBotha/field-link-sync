-- Rollback Q2
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_quotes_for_lead(uuid)'::regprocedure);
  IF position('/*rh2*/' in d) > 0 THEN
    EXECUTE replace(d, ' AND (NOT public.is_sales_rep(auth.uid()) OR auth.uid() IN (q.sales_engineer_id, q.owner_id, q.created_by) OR EXISTS (SELECT 1 FROM public.leads l2 WHERE l2.id = q.lead_id AND auth.uid() IN (l2.created_by, l2.assigned_agent_id))) /*rh2*/', '');
  END IF;
END $$;
