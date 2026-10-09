-- P5 rollback
DO $$ DECLARE d text; BEGIN SELECT def INTO d FROM backup_p4_20261009.functions WHERE proname='get_public_quote'; EXECUTE d; END $$;
DROP POLICY IF EXISTS p5_cs_select ON public.company_settings;
DROP POLICY IF EXISTS p5_cs_insert ON public.company_settings;
DROP POLICY IF EXISTS p5_cs_update ON public.company_settings;
DELETE FROM public.company_network_members WHERE master_company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
DELETE FROM public.company_members WHERE company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
DELETE FROM public.user_roles r WHERE r.user_id='1e795a9b-f8bd-4af5-8f28-5e0426101daa' AND r.role='admin'
  AND NOT EXISTS (SELECT 1 FROM backup_p4_20261009.p5_user_roles b WHERE b.user_id=r.user_id AND b.role=r.role);
UPDATE public.profiles p SET company_id=b.company_id, participant_type=b.participant_type, dispatch_role=b.dispatch_role
  FROM backup_p4_20261009.p5_profiles b WHERE b.id=p.id;
UPDATE public.companies c SET is_master=b.is_master FROM backup_p4_20261009.p5_companies b WHERE b.id=c.id;
DELETE FROM public.company_settings WHERE company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
DELETE FROM public.companies WHERE id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';  -- fails safely if the new company already has data
UPDATE public.quotes SET company_id = NULL WHERE id IN (SELECT id FROM backup_p4_20261009.p5_null_quotes);
-- P5b rollback (run first)
-- DROP POLICY IF EXISTS p5_profiles_scope ON public.profiles; DROP FUNCTION IF EXISTS public.p5_profile_visible(uuid, uuid);
-- UPDATE public.agent_affiliations a SET status = b.status FROM backup_p4_20261009.p5_affiliations b WHERE b.id = a.id;
