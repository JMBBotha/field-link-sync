DROP FUNCTION IF EXISTS public.get_my_visits(integer);
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_my_appointments(integer)'::regprocedure);
  IF position('/*p1lane*/' in d) > 0 THEN
    EXECUTE replace(d, 'OR (l.assigned_agent_id IS NULL AND l.status = ''pending'' /*p1lane*/ AND (NOT public.is_sales_rep(auth.uid()) OR COALESCE(l.primary_intent::text, ''sales'') = ''sales'')))',
      'OR (l.assigned_agent_id IS NULL AND l.status = ''pending''))');
  END IF;
END $$;
