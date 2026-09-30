-- STEP 2 role hide list (sales reps + techs). Rollback: rollback.sql
-- 1. Helpers (SECURITY DEFINER, read-only)
CREATE OR REPLACE FUNCTION public.is_sales_rep(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT _uid IS NOT NULL
    AND public.has_role(_uid, 'dispatcher'::app_role)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.dispatch_role IN ('sales','sales_engineer'))
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin','platform_super_admin','platform_ops'))
    AND NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = _uid AND cm.role = 'admin');
$f$;

CREATE OR REPLACE FUNCTION public.rh_assert(_block_sales boolean) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF public.is_field_tech_only(auth.uid()) THEN RAISE EXCEPTION 'Not available to technicians' USING ERRCODE = '42501'; END IF;
  IF _block_sales AND public.is_sales_rep(auth.uid()) THEN RAISE EXCEPTION 'Not available to sales reps' USING ERRCODE = '42501'; END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.rh_ops_ok(_company uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT auth.uid() IS NULL OR (public.is_ops_user(auth.uid()) AND _company = public.caller_company_id());
$f$;

-- lead is the tech's own work (assigned / job assignment / schedule / completion)
CREATE OR REPLACE FUNCTION public.tech_owns_lead(_uid uuid, _lead uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.assigned_agent_id = _uid)
    OR EXISTS (SELECT 1 FROM public.jobs j JOIN public.assignments a ON a.job_id = j.id WHERE j.lead_id = _lead AND a.profile_id = _uid)
    OR EXISTS (SELECT 1 FROM public.job_schedules s WHERE s.lead_id = _lead AND s.agent_id = _uid)
    OR EXISTS (SELECT 1 FROM public.job_completions c WHERE c.lead_id = _lead AND c.technician_id = _uid);
$f$;

-- own work + available pool (pending & unassigned) + offers made to the tech
CREATE OR REPLACE FUNCTION public.tech_can_see_lead(_uid uuid, _lead uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT public.tech_owns_lead(_uid, _lead)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = _lead AND l.status = 'pending' AND l.assigned_agent_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.lead_id = _lead AND o.staff_id = _uid);
$f$;

CREATE OR REPLACE FUNCTION public.tech_can_see_job(_uid uuid, _job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = _job AND a.profile_id = _uid)
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job AND (j.created_by = _uid OR (j.lead_id IS NOT NULL AND public.tech_can_see_lead(_uid, j.lead_id))));
$f$;

CREATE OR REPLACE FUNCTION public.tech_can_see_customer(_uid uuid, _customer uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.leads l WHERE l.customer_id = _customer AND public.tech_can_see_lead(_uid, l.id))
    OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.customer_id = _customer AND public.tech_can_see_job(_uid, j.id));
$f$;

-- invoice belongs to the rep's own quotes / clients
CREATE OR REPLACE FUNCTION public.rep_can_see_invoice(_uid uuid, _inv uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = _inv AND (
      i.agent_id = _uid
      OR EXISTS (SELECT 1 FROM public.quotes q WHERE _uid IN (q.sales_engineer_id, q.created_by, q.owner_id)
                 AND (q.id = i.quote_id
                      OR (i.customer_id IS NOT NULL AND q.customer_id = i.customer_id)
                      OR (i.lead_id IS NOT NULL AND q.lead_id = i.lead_id)
                      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.invoice_id = i.id AND j.quote_id = q.id)))));
$f$;

-- job-photos storage: same company only; techs only for leads they can see
CREATE OR REPLACE FUNCTION public.rh_photo_ok(_name text, _owner text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE WHEN (storage.foldername(_name))[1] ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
       AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = ((storage.foldername(_name))[1])::uuid)
    THEN EXISTS (SELECT 1 FROM public.leads l WHERE l.id = ((storage.foldername(_name))[1])::uuid
                 AND l.company_id = public.caller_company_id()
                 AND (NOT public.is_field_tech_only(auth.uid()) OR public.tech_can_see_lead(auth.uid(), l.id)))
    ELSE _owner = auth.uid()::text
      OR (NOT public.is_field_tech_only(auth.uid())
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id::text = _owner AND p.company_id = public.caller_company_id()))
  END;
$f$;

DO $rh$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['is_sales_rep(uuid)','rh_assert(boolean)','rh_ops_ok(uuid)','tech_owns_lead(uuid,uuid)','tech_can_see_lead(uuid,uuid)','tech_can_see_job(uuid,uuid)','tech_can_see_customer(uuid,uuid)','rep_can_see_invoice(uuid,uuid)','rh_photo_ok(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $rh$;

-- 2. Function guards: exact-text insertions into the live definitions (rollback.sql removes the same text)
DO $rh$ DECLARE r record; d text; BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('revenue_trend_monthly()', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('agent_performance_scores()', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('quote_conversion_funnel()', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('revenue_by_agent()', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('revenue_by_service_type()', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('job_profit_loss(uuid)', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('get_invoice_aging_report()', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(true); -- rh\n'),
    ('past_quote_analytics(text)', E'\nBEGIN\n', E'\nBEGIN\n  PERFORM public.rh_assert(false); -- rh\n'),
    ('get_quotes_for_lead(uuid)', 'AND l.company_id = public.get_user_company_id(auth.uid())', 'AND l.company_id = public.get_user_company_id(auth.uid()) AND (NOT public.is_field_tech_only(auth.uid()) OR public.tech_can_see_lead(auth.uid(), l.id)) /*rh*/'),
    ('get_recently_active_customers(uuid,integer)', 'WHERE c.company_id = p_company_id', 'WHERE c.company_id = p_company_id AND public.rh_ops_ok(c.company_id) /*rh*/'),
    ('get_agreements_due_for_service(integer)', E'WHERE sa.status = \'active\'', E'WHERE sa.status = \'active\' AND public.rh_ops_ok(sa.company_id) /*rh*/'),
    ('find_dispatch_candidates(uuid,text,numeric,text)', 'FROM public.leads WHERE id = p_lead_id)', 'FROM public.leads WHERE id = p_lead_id AND public.rh_ops_ok(company_id) /*rh*/)'),
    ('find_dispatch_candidates_multi(uuid,text,numeric,text[])', 'FROM public.leads WHERE id = p_lead_id)', 'FROM public.leads WHERE id = p_lead_id AND public.rh_ops_ok(company_id) /*rh*/)'),
    ('broadcast_lead_to_agents(uuid,numeric)', E'WHERE id = p_lead_id;\n', E'WHERE id = p_lead_id;\n  IF NOT public.rh_ops_ok(v_company_id) THEN RAISE EXCEPTION \'Not allowed\' USING ERRCODE = \'42501\'; END IF; -- rh\n')
  ) v(fn, a, b) LOOP
    d := pg_get_functiondef(('public.' || r.fn)::regprocedure);
    IF (length(d) - length(replace(d, r.a, ''))) / length(r.a) <> 1 THEN RAISE EXCEPTION 'rh: anchor not unique in %', r.fn; END IF;
    EXECUTE replace(d, r.a, r.b);
  END LOOP;
END $rh$;

-- invoice_amount_paid / get_job_billable_hours: only ever called inside SECURITY DEFINER functions
-- (portal, quote link, get_my_assigned_jobs, get_field_deposit_chips). Remove direct client calls so a
-- tech/rep cannot query arbitrary invoices/jobs; nested callers keep working unchanged.
REVOKE EXECUTE ON FUNCTION public.invoice_amount_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_job_billable_hours(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Tech row scope (RESTRICTIVE, SELECT)
CREATE POLICY rh_tech_scope ON public.leads AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR public.tech_can_see_lead(auth.uid(), id));
CREATE POLICY rh_tech_scope ON public.jobs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR public.tech_can_see_job(auth.uid(), id));
CREATE POLICY rh_tech_scope ON public.assignments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR profile_id = auth.uid() OR public.tech_can_see_job(auth.uid(), job_id));
CREATE POLICY rh_tech_scope ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR public.tech_can_see_customer(auth.uid(), id));
CREATE POLICY rh_tech_scope ON public.customer_locations AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR public.tech_can_see_customer(auth.uid(), customer_id));
CREATE POLICY rh_tech_scope ON public.service_agreements AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR public.tech_can_see_customer(auth.uid(), customer_id));
CREATE POLICY rh_tech_scope ON public.communication_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR agent_id = auth.uid()
         OR (lead_id IS NOT NULL AND public.tech_can_see_lead(auth.uid(), lead_id))
         OR (customer_id IS NOT NULL AND public.tech_can_see_customer(auth.uid(), customer_id)));
CREATE POLICY rh_tech_scope ON public.job_activity_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR user_id = auth.uid() OR public.tech_can_see_job(auth.uid(), job_id));
CREATE POLICY rh_tech_scope ON public.status_change_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid()))
         OR (entity_type = 'lead' AND public.tech_can_see_lead(auth.uid(), entity_id))
         OR (entity_type = 'job' AND public.tech_can_see_job(auth.uid(), entity_id)));
CREATE POLICY rh_tech_scope ON public.call_reports AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_field_tech_only(auth.uid())) OR (lead_id IS NOT NULL AND public.tech_can_see_lead(auth.uid(), lead_id)));
CREATE POLICY rh_tech_block ON public.vapi_calls AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
CREATE POLICY rh_tech_block ON public.import_audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
CREATE POLICY rh_tech_block ON public.supplier_contacts AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
CREATE POLICY rh_tech_block ON public.price_list_uploads AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
-- companies row carries units/materials markup % (lets a tech back-calculate cost)
CREATE POLICY rh_tech_block ON public.companies AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
-- techs cannot create invoices / invoice lines
CREATE POLICY rh_tech_no_insert ON public.invoices AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_field_tech_only(auth.uid())));
CREATE POLICY rh_tech_no_insert ON public.invoice_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_field_tech_only(auth.uid())));
-- job_photos rows: caller's company only
CREATE POLICY rh_company_scope ON public.job_photos AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = job_photos.lead_id AND l.company_id = public.caller_company_id()));

-- 4. Sales rep scope: invoices only for own quotes/clients (RESTRICTIVE, SELECT)
CREATE POLICY rh_rep_scope ON public.invoices AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_sales_rep(auth.uid())) OR public.rep_can_see_invoice(auth.uid(), id));
CREATE POLICY rh_rep_scope ON public.invoice_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_sales_rep(auth.uid())) OR public.rep_can_see_invoice(auth.uid(), invoice_id));
CREATE POLICY rh_rep_scope ON public.payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_sales_rep(auth.uid())) OR (invoice_id IS NOT NULL AND public.rep_can_see_invoice(auth.uid(), invoice_id)));

-- 5. Storage job-photos read: add company / tech-visibility scope
DROP POLICY IF EXISTS "Authenticated staff can view job photos" ON storage.objects;
CREATE POLICY "Authenticated staff can view job photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-photos'
         AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'field_agent'::app_role))
         AND public.rh_photo_ok(name, owner_id));

-- 6. Job completion upsert fix: full unique index (NULLs still allowed) + tech merge trigger
DROP INDEX IF EXISTS public.job_completions_lead_unique;
CREATE UNIQUE INDEX job_completions_lead_unique ON public.job_completions USING btree (lead_id);
CREATE OR REPLACE FUNCTION public.job_completions_rh_merge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE u uuid := auth.uid();
BEGIN
  -- techs cannot SELECT job_completions (cost), so ON CONFLICT upserts fail for them; merge here instead
  IF pg_trigger_depth() > 1 OR NEW.lead_id IS NULL OR u IS NULL OR NOT public.is_field_tech_only(u) THEN RETURN NEW; END IF;
  IF NEW.technician_id IS DISTINCT FROM u OR NOT public.tech_can_see_lead(u, NEW.lead_id)
     OR (NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM public.caller_company_id()) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.job_completions SET job_id = NEW.job_id, work_summary = NEW.work_summary, customer_name = NEW.customer_name,
    customer_email = NEW.customer_email, signature_data_url = NEW.signature_data_url, signed_at = NEW.signed_at,
    labour_minutes = NEW.labour_minutes, photo_count = NEW.photo_count, status = NEW.status, completed_at = NEW.completed_at
  WHERE lead_id = NEW.lead_id AND technician_id = u;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.job_completions WHERE lead_id = NEW.lead_id) THEN
      RAISE EXCEPTION 'Completion already recorded by another technician' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.job_completions SELECT NEW.*;
  END IF;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.job_completions_rh_merge() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_job_completions_0_merge BEFORE INSERT ON public.job_completions FOR EACH ROW EXECUTE FUNCTION public.job_completions_rh_merge();