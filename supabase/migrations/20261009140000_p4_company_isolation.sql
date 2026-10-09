-- P4 company isolation + tech-assignment gap (2026-10-09). Additive RESTRICTIVE policies only; rollback.sql reverses.
-- Helpers (definer, stable). NULL company = legacy/global row -> unchanged behaviour.
CREATE OR REPLACE FUNCTION public.p4_is_platform() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(auth.uid(),'platform_super_admin'::app_role) OR public.has_role(auth.uid(),'platform_ops'::app_role) $$;
CREATE OR REPLACE FUNCTION public.p4_co_ok(_co uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _co IS NULL OR auth.uid() IS NULL
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.company_id = _co)
    OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = auth.uid() AND cm.company_id = _co)
    OR public.p4_is_platform() $$;
CREATE OR REPLACE FUNCTION public.p4_lead_ok(_lead uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _lead IS NULL OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=_lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id=_lead AND (public.p4_co_ok(l.company_id) OR l.assigned_agent_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id=_lead AND o.staff_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.jobs j JOIN public.assignments a ON a.job_id=j.id WHERE j.lead_id=_lead AND a.profile_id=auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.p4_job_ok(_job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _job IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=_job)
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=_job AND public.p4_co_ok(j.company_id))
    OR EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id=_job AND a.profile_id=auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.p4_quote_ok(_q uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _q IS NULL OR NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.id=_q)
    OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id=_q AND (public.p4_co_ok(q.company_id) OR q.created_by = auth.uid())) $$;
CREATE OR REPLACE FUNCTION public.p4_invoice_ok(_i uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _i IS NULL OR NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id=_i)
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id=_i AND (public.p4_co_ok(i.company_id) OR i.agent_id = auth.uid())) $$;
CREATE OR REPLACE FUNCTION public.p4_customer_ok(_c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _c IS NULL OR NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id=_c)
    OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id=_c AND (public.p4_co_ok(c.company_id) OR c.created_by = auth.uid())) $$;
CREATE OR REPLACE FUNCTION public.p4_user_ok(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _u = auth.uid() OR public.p4_is_platform()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_u AND public.p4_co_ok(p.company_id))
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_u) $$;
CREATE OR REPLACE FUNCTION public.p4_is_ops() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'dispatcher'::app_role) OR public.p4_is_platform() $$;

-- 1) Company scope on every company_id table (except membership/identity tables, which have their own rules)
DO $$
DECLARE t text; own text; selfw text; usingx text; checkx text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped
           WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
             AND c.relname NOT IN ('company_members','profiles','agent_affiliations','team_invites','company_settings')
  LOOP
    -- own rows stay visible (owner / assignee columns); writes may only bypass company via person-owned columns
    SELECT string_agg(format('%I = auth.uid()', column_name), ' OR ') INTO own
      FROM information_schema.columns WHERE table_schema='public' AND table_name=t
       AND column_name IN ('user_id','profile_id','staff_id','technician_id','tech_id','assigned_agent_id','rep_id','created_by','agent_id');
    SELECT string_agg(format('%I = auth.uid()', column_name), ' OR ') INTO selfw
      FROM information_schema.columns WHERE table_schema='public' AND table_name=t
       AND column_name IN ('profile_id','staff_id','technician_id','tech_id','assigned_agent_id');
    usingx := 'public.p4_co_ok(company_id)' || coalesce(' OR '||own,'');
    IF t='jobs' THEN usingx := usingx || ' OR public.user_is_assigned_to_job(auth.uid(), id)'; END IF;
    checkx := 'public.p4_co_ok(company_id)' || coalesce(' OR '||selfw,'');
    EXECUTE format('DROP POLICY IF EXISTS p4_company_scope ON public.%I', t);
    EXECUTE format('CREATE POLICY p4_company_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', t, usingx, checkx);
  END LOOP;
END $$;

-- 2) Child tables scoped through their parent
DROP POLICY IF EXISTS p4_parent_scope ON public.quote_line_items;
CREATE POLICY p4_parent_scope ON public.quote_line_items AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_quote_ok(quote_id)) WITH CHECK (public.p4_quote_ok(quote_id));
DROP POLICY IF EXISTS p4_parent_scope ON public.quote_attachments;
CREATE POLICY p4_parent_scope ON public.quote_attachments AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_quote_ok(quote_id)) WITH CHECK (public.p4_quote_ok(quote_id));
DROP POLICY IF EXISTS p4_parent_scope ON public.invoice_items;
CREATE POLICY p4_parent_scope ON public.invoice_items AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_invoice_ok(invoice_id)) WITH CHECK (public.p4_invoice_ok(invoice_id));
DROP POLICY IF EXISTS p4_parent_scope ON public.customer_tokens;
CREATE POLICY p4_parent_scope ON public.customer_tokens AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_customer_ok(customer_id)) WITH CHECK (public.p4_customer_ok(customer_id));
DROP POLICY IF EXISTS p4_parent_scope ON public.customer_units;
CREATE POLICY p4_parent_scope ON public.customer_units AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_customer_ok(customer_id)) WITH CHECK (public.p4_customer_ok(customer_id));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['job_expenses','job_photos','job_time_entries','job_used_parts','lead_change_requests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p4_parent_scope ON public.%I', t);
    EXECUTE format('CREATE POLICY p4_parent_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_lead_ok(lead_id)) WITH CHECK (public.p4_lead_ok(lead_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['communication_log','maintenance_schedules'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p4_parent_scope ON public.%I', t);
    EXECUTE format('CREATE POLICY p4_parent_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_lead_ok(lead_id) AND public.p4_customer_ok(customer_id)) WITH CHECK (public.p4_lead_ok(lead_id) AND public.p4_customer_ok(customer_id))', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS p4_parent_scope ON public.job_schedules;
CREATE POLICY p4_parent_scope ON public.job_schedules AS RESTRICTIVE FOR ALL TO authenticated
  USING (agent_id = auth.uid() OR (public.p4_lead_ok(lead_id) AND public.p4_job_ok(job_id)))
  WITH CHECK (agent_id = auth.uid() OR (public.p4_lead_ok(lead_id) AND public.p4_job_ok(job_id)));
DROP POLICY IF EXISTS p4_parent_scope ON public.assignments;
CREATE POLICY p4_parent_scope ON public.assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING (profile_id = auth.uid() OR public.p4_job_ok(job_id)) WITH CHECK (profile_id = auth.uid() OR public.p4_job_ok(job_id));

-- 3) Tech-assignment gap: only office (admin/dispatcher/platform) may write someone else's assignment; a tech may only write their own row
DROP POLICY IF EXISTS p4_assign_ins ON public.assignments;
CREATE POLICY p4_assign_ins ON public.assignments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid() OR public.p4_is_ops());
DROP POLICY IF EXISTS p4_assign_upd ON public.assignments;
CREATE POLICY p4_assign_upd ON public.assignments AS RESTRICTIVE FOR UPDATE TO authenticated USING (profile_id = auth.uid() OR public.p4_is_ops()) WITH CHECK (profile_id = auth.uid() OR public.p4_is_ops());
DROP POLICY IF EXISTS p4_assign_del ON public.assignments;
CREATE POLICY p4_assign_del ON public.assignments AS RESTRICTIVE FOR DELETE TO authenticated USING (profile_id = auth.uid() OR public.p4_is_ops());

-- 4) user_roles: admins only see/manage people in their own company; platform roles only granted by platform staff
DROP POLICY IF EXISTS p4_roles_sel ON public.user_roles;
CREATE POLICY p4_roles_sel ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated USING (public.p4_user_ok(user_id));
DROP POLICY IF EXISTS p4_roles_ins ON public.user_roles;
CREATE POLICY p4_roles_ins ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.p4_is_platform() OR (role NOT IN ('platform_super_admin','platform_ops') AND public.p4_user_ok(user_id)));
DROP POLICY IF EXISTS p4_roles_upd ON public.user_roles;
CREATE POLICY p4_roles_upd ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.p4_is_platform() OR (role NOT IN ('platform_super_admin','platform_ops') AND public.p4_user_ok(user_id)))
  WITH CHECK (public.p4_is_platform() OR (role NOT IN ('platform_super_admin','platform_ops') AND public.p4_user_ok(user_id)));
DROP POLICY IF EXISTS p4_roles_del ON public.user_roles;
CREATE POLICY p4_roles_del ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.p4_is_platform() OR (role NOT IN ('platform_super_admin','platform_ops') AND public.p4_user_ok(user_id)));

-- 5) company_settings per company (all existing rows belong to AB today)
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
UPDATE public.company_settings SET company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' WHERE company_id IS NULL;
ALTER TABLE public.company_settings ALTER COLUMN company_id SET DEFAULT public.caller_company_id();
DROP POLICY IF EXISTS p4_company_scope ON public.company_settings;
CREATE POLICY p4_company_scope ON public.company_settings AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.p4_co_ok(company_id)) WITH CHECK (company_id IS NOT NULL AND public.p4_co_ok(company_id));

-- 6) Deposit % prefers the quote's own company settings row (same row as today for AB)
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.create_deposit_invoice_for_quote(uuid)'::regprocedure);
  IF position('/*p4cs*/' in d) = 0 THEN
    d := replace(d, 'FROM public.company_settings ORDER BY updated_at DESC NULLS LAST, id LIMIT 1;',
                    'FROM public.company_settings ORDER BY (company_id IS NOT DISTINCT FROM q.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p4cs*/');
    IF position('/*p4cs*/' in d) = 0 THEN RAISE EXCEPTION 'p4: deposit reader pattern not found'; END IF;
    EXECUTE d;
  END IF;
END $$;

-- 7) Unclaimed-lead visibility for techs limited to their own company
CREATE OR REPLACE FUNCTION public.tech_can_see_lead(_uid uuid, _lead uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.status = 'pending' AND l.assigned_agent_id IS NULL
               AND (l.company_id IS NULL OR l.company_id = public.get_user_company_id(_uid)
                    OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=l.company_id))) /*p4*/
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid);
$function$;
