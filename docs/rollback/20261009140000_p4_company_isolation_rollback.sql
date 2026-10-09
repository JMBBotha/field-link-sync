-- P4 rollback
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND policyname IN
    ('p4_company_scope','p4_parent_scope','p4_assign_ins','p4_assign_upd','p4_assign_del','p4_roles_sel','p4_roles_ins','p4_roles_upd','p4_roles_del')
  LOOP EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename); END LOOP;
END $$;
DO $$ DECLARE d text; BEGIN
  SELECT def INTO d FROM backup_p4_20261009.functions WHERE proname='create_deposit_invoice_for_quote'; EXECUTE d;
  SELECT def INTO d FROM backup_p4_20261009.functions WHERE proname='tech_can_see_lead'; EXECUTE d;
END $$;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS company_id;
DROP FUNCTION IF EXISTS public.p4_user_ok(uuid), public.p4_customer_ok(uuid), public.p4_invoice_ok(uuid), public.p4_quote_ok(uuid),
  public.p4_job_ok(uuid), public.p4_lead_ok(uuid), public.p4_co_ok(uuid), public.p4_is_ops(), public.p4_is_platform();
