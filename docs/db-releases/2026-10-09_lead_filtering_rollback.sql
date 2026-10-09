-- Rollback lead filtering
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.get_my_appointments(integer)'::regprocedure);
  IF position('/*lf*/' in d) > 0 THEN
    EXECUTE replace(d, 'OR (COALESCE(l.primary_intent::text, ''sales'') = ''sales'' /*lf*/ AND EXISTS (SELECT 1 FROM public.rep_offerable_leads() o WHERE o.lead_id = l.id)))))',
      'OR COALESCE(l.primary_intent::text, ''sales'') = ''sales'')))');
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.get_lead_offer_flags();
DROP FUNCTION IF EXISTS public.rep_offerable_leads();
DROP FUNCTION IF EXISTS public._rep_lead_fit(uuid, uuid);
