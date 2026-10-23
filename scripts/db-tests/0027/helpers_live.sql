-- Live helper bodies (copied 23 Oct 2026) + stubs for things the 0027 code path does not depend on.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.caller_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT min(cm.company_id::text)::uuid FROM public.company_members cm
      WHERE cm.user_id = auth.uid() HAVING count(DISTINCT cm.company_id) = 1));
$function$;

CREATE OR REPLACE FUNCTION public.fl_master_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.companies where is_master order by created_at limit 1 $function$;

CREATE OR REPLACE FUNCTION public.audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
    VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, user_id)
    VALUES (TG_TABLE_NAME, OLD.id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._hb_limit(p_company uuid, p_key text, p_default numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select (cs.sales_stage_limits->>p_key)::numeric from public.company_settings cs where cs.company_id = p_company limit 1), p_default)
$function$;

CREATE OR REPLACE FUNCTION public._hb_admins(p_company uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct pr.id), '{}') from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
   where pr.company_id = p_company and ur.role = 'admin'
$function$;

CREATE OR REPLACE FUNCTION public._hb_sales(p_company uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct pr.id), '{}') from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
   where pr.company_id = p_company and ur.role = 'dispatcher' and pr.dispatch_role in ('sales','sales_engineer')
$function$;

CREATE OR REPLACE FUNCTION public._hb_dispatch(p_company uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct pr.id), '{}') from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
   where pr.company_id = p_company and ur.role = 'dispatcher' and coalesce(pr.dispatch_role,'') not in ('sales','sales_engineer')
$function$;


CREATE OR REPLACE FUNCTION public.fl_quote_items_lock_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.quote_lock_bypass', true),'') <> 'on'
     AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = coalesce(NEW.quote_id, OLD.quote_id) AND q.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This quote is confirmed and locked for its installation. An admin must unlock it before it can be changed.' USING ERRCODE='P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END $function$;

-- Test stubs: record nudges instead of sending anything.
CREATE TABLE IF NOT EXISTS public._test_nudges (company uuid, typ text, id uuid, stage text);
CREATE OR REPLACE FUNCTION public._hb_nudge(p_company uuid, p_type text, p_id uuid, p_stage text, p_level integer, p_users uuid[], p_title text, p_body text)
 RETURNS void LANGUAGE sql AS $$ INSERT INTO public._test_nudges VALUES (p_company, p_type, p_id, p_stage) $$;
CREATE OR REPLACE FUNCTION public.process_invoice_followups() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE OR REPLACE FUNCTION public._quote_is_visit(p_quote uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

DROP TRIGGER IF EXISTS audit_quotes ON public.quotes;
CREATE TRIGGER audit_quotes AFTER INSERT OR DELETE OR UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION audit_trigger();
DROP TRIGGER IF EXISTS audit_invoices ON public.invoices;
CREATE TRIGGER audit_invoices AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION audit_trigger();
DROP TRIGGER IF EXISTS trg_quote_items_lock_guard ON public.quote_items;
CREATE TRIGGER trg_quote_items_lock_guard BEFORE INSERT OR DELETE OR UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION fl_quote_items_lock_guard();
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- Not in the structural copy; only read by _hb_limit (empty = defaults).
CREATE TABLE IF NOT EXISTS public.company_settings (company_id uuid, sales_stage_limits jsonb);
