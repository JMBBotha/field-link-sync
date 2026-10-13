-- Grok work assistant phases 5-7 (Johan 13 Oct 2026). ADDITIVE ONLY. Billing stays OFF.
-- Rollback: docs/db-releases/2026-10-13_gwa_p5_p7_rollback.sql
-- ===== Phase 5: top-level (parent) Mandy, Johan only, read-only across child companies =====
CREATE TABLE IF NOT EXISTS public.parent_mandy_users (
  user_id uuid PRIMARY KEY, added_at timestamptz NOT NULL DEFAULT now(), note text);
ALTER TABLE public.parent_mandy_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_mandy_users FROM anon, authenticated;
INSERT INTO public.parent_mandy_users (user_id, note)
  VALUES ('1e795a9b-f8bd-4af5-8f28-5e0426101daa','Johan (Massair) - top-level Mandy') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_parent_owner(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.parent_mandy_users p WHERE p.user_id = _uid)
     AND public.is_master_company_user(_uid) AND public.has_role(_uid,'admin'::app_role)
$$;
REVOKE ALL ON FUNCTION public.is_parent_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_parent_owner(uuid) TO authenticated, service_role;

-- Read-only cross-company overview. Aggregates only; no writes; audited.
CREATE OR REPLACE FUNCTION public.parent_overview() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  IF NOT public.is_parent_owner(auth.uid()) THEN RAISE EXCEPTION 'Top-level Mandy is for the Massair owner only.'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'company'), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object(
      'company_id', c.id, 'company', btrim(c.name), 'is_master', c.is_master,
      'leads_today', (SELECT count(*) FROM leads l WHERE l.company_id=c.id AND l.deleted_at IS NULL AND (l.created_at AT TIME ZONE 'Africa/Johannesburg')::date = d),
      'leads_30d', (SELECT count(*) FROM leads l WHERE l.company_id=c.id AND l.deleted_at IS NULL AND l.created_at > now()-interval '30 days'),
      'quotes_waiting', (SELECT count(*) FROM quotes q WHERE q.company_id=c.id AND q.status IN ('sent','viewed')),
      'quotes_waiting_value', (SELECT coalesce(sum(q.total),0) FROM quotes q WHERE q.company_id=c.id AND q.status IN ('sent','viewed')),
      'invoices_open', (SELECT count(*) FROM invoices i WHERE i.company_id=c.id AND i.status NOT IN ('paid','draft','cancelled','void','archived')),
      'outstanding', (SELECT coalesce(sum(i.grand_total),0) FROM invoices i WHERE i.company_id=c.id AND i.status NOT IN ('paid','draft','cancelled','void','archived')),
      'overdue_count', (SELECT count(*) FROM invoices i WHERE i.company_id=c.id AND i.due_date < d AND i.status NOT IN ('paid','draft','cancelled','void','archived')),
      'overdue_value', (SELECT coalesce(sum(i.grand_total),0) FROM invoices i WHERE i.company_id=c.id AND i.due_date < d AND i.status NOT IN ('paid','draft','cancelled','void','archived')),
      'paid_this_month', (SELECT coalesce(sum(i.grand_total),0) FROM invoices i WHERE i.company_id=c.id AND i.status='paid' AND i.paid_date >= date_trunc('month', d)::date),
      'jobs_today', (SELECT count(*) FROM jobs j WHERE j.company_id=c.id AND (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date = d),
      'jobs_open', (SELECT count(*) FROM jobs j WHERE j.company_id=c.id AND j.status IN ('scheduled','in_progress','pending','assigned')),
      'followups_pending', (SELECT count(*) FROM payment_followups f WHERE f.company_id=c.id AND f.status='pending'),
      'users', (SELECT count(*) FROM profiles p WHERE p.company_id=c.id),
      'plan_status', c.plan_status, 'mandy_enabled', c.mandy_enabled) AS x
    FROM companies c) s;
  INSERT INTO nl_audit_log (user_id, company_id, tool_name, args, result, status, resource_type)
    VALUES (auth.uid(), public.get_user_company_id(auth.uid()), 'mandy_parent:overview', '{"channel":"mandy_parent"}'::jsonb, jsonb_build_object('companies', jsonb_array_length(r)), 'success', 'voice_action');
  RETURN jsonb_build_object('date', d, 'companies', r);
END $$;
REVOKE ALL ON FUNCTION public.parent_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.parent_overdue(p_limit int DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; d date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  IF NOT public.is_parent_owner(auth.uid()) THEN RAISE EXCEPTION 'Top-level Mandy is for the Massair owner only.'; END IF;
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('company', btrim(c.name), 'invoice_number', i.invoice_number, 'customer_name', i.customer_name,
      'amount', i.grand_total, 'due_date', i.due_date, 'days_late', d - i.due_date) AS x
    FROM invoices i JOIN companies c ON c.id=i.company_id
    WHERE i.due_date < d AND i.status NOT IN ('paid','draft','cancelled','void','archived')
    ORDER BY i.due_date LIMIT greatest(1, least(coalesce(p_limit,20), 50))) s;
  INSERT INTO nl_audit_log (user_id, company_id, tool_name, args, result, status, resource_type)
    VALUES (auth.uid(), public.get_user_company_id(auth.uid()), 'mandy_parent:overdue', '{"channel":"mandy_parent"}'::jsonb, jsonb_build_object('rows', jsonb_array_length(r)), 'success', 'voice_action');
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.parent_overdue(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_overdue(int) TO authenticated;

-- ===== Phase 6: usage meter, plan enforcement (7-day grace, auto-off), contract at signup =====
CREATE TABLE IF NOT EXISTS public.mandy_usage (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Johannesburg')::date,
  mandy text NOT NULL DEFAULT 'company' CHECK (mandy IN ('company','parent')),
  commands int NOT NULL DEFAULT 0,
  tts_calls int NOT NULL DEFAULT 0,
  tts_chars int NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, user_id, day, mandy));
ALTER TABLE public.mandy_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mu_select ON public.mandy_usage;
CREATE POLICY mu_select ON public.mandy_usage FOR SELECT TO authenticated USING (
  (company_id = public.get_user_company_id(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role) AND NOT public.is_sales_rep(auth.uid()))
  OR (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)));
REVOKE INSERT, UPDATE, DELETE ON public.mandy_usage FROM anon, authenticated;
GRANT SELECT ON public.mandy_usage TO authenticated;

-- Server-only meter bump (mandy-agent, service role).
CREATE OR REPLACE FUNCTION public.mandy_usage_bump(p_company uuid, p_user uuid, p_mandy text, p_commands int, p_tts_calls int, p_tts_chars int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO mandy_usage (company_id, user_id, mandy, commands, tts_calls, tts_chars)
  VALUES (p_company, p_user, CASE WHEN p_mandy='parent' THEN 'parent' ELSE 'company' END, greatest(p_commands,0), greatest(p_tts_calls,0), greatest(p_tts_chars,0))
  ON CONFLICT (company_id, user_id, day, mandy) DO UPDATE SET
    commands = mandy_usage.commands + EXCLUDED.commands, tts_calls = mandy_usage.tts_calls + EXCLUDED.tts_calls, tts_chars = mandy_usage.tts_chars + EXCLUDED.tts_chars
$$;
REVOKE ALL ON FUNCTION public.mandy_usage_bump(uuid,uuid,text,int,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mandy_usage_bump(uuid,uuid,text,int,int,int) TO service_role;

-- Contract acceptances (one row per acceptance, immutable).
CREATE TABLE IF NOT EXISTS public.company_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contract_version text NOT NULL,
  months int NOT NULL, base_price_zar numeric(10,2) NOT NULL, included_users int NOT NULL, extra_user_price_zar numeric(10,2) NOT NULL,
  signer_name text NOT NULL, accepted_by uuid NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
  starts_on date NOT NULL, ends_on date NOT NULL, user_agent text);
ALTER TABLE public.company_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cc_select ON public.company_contracts;
CREATE POLICY cc_select ON public.company_contracts FOR SELECT TO authenticated USING (
  company_id = public.get_user_company_id(auth.uid()) OR (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)));
REVOKE INSERT, UPDATE, DELETE ON public.company_contracts FROM anon, authenticated;
GRANT SELECT ON public.company_contracts TO authenticated;

-- Plan guard: allow changes made inside the sanctioned plan RPCs (flag set per transaction).
CREATE OR REPLACE FUNCTION public._companies_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.plan_rpc', true),'') = '1' THEN RETURN NEW; END IF;
  IF (NEW.plan_code, NEW.plan_status, NEW.plan_base_price_zar, NEW.plan_included_users, NEW.plan_extra_user_price_zar,
      NEW.plan_contract_months, NEW.contract_signed_at, NEW.contract_signed_by, NEW.contract_ends_at, NEW.plan_grace_until,
      NEW.mandy_enabled, NEW.billing_live)
     IS DISTINCT FROM
     (OLD.plan_code, OLD.plan_status, OLD.plan_base_price_zar, OLD.plan_included_users, OLD.plan_extra_user_price_zar,
      OLD.plan_contract_months, OLD.contract_signed_at, OLD.contract_signed_by, OLD.contract_ends_at, OLD.plan_grace_until,
      OLD.mandy_enabled, OLD.billing_live)
     AND NOT (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)) THEN
    RAISE EXCEPTION 'Plan settings can only be changed by the main system (Massair).';
  END IF;
  RETURN NEW;
END $$;

-- Company admin accepts the 36-month contract (at signup). Terms come from Massair's plan fields, never the browser.
CREATE OR REPLACE FUNCTION public.accept_company_contract(p_signer_name text, p_version text DEFAULT '2026-10-13', p_user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid := public.get_user_company_id(auth.uid()); c record; s date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; e date;
BEGIN
  IF auth.uid() IS NULL OR cid IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  IF NOT public.has_role(auth.uid(),'admin'::app_role) OR public.is_sales_rep(auth.uid()) THEN RAISE EXCEPTION 'Only the company owner or admin can accept the contract.'; END IF;
  IF char_length(btrim(coalesce(p_signer_name,''))) < 3 THEN RAISE EXCEPTION 'Type your full name to sign.'; END IF;
  SELECT * INTO c FROM companies WHERE id = cid FOR UPDATE;
  IF c.contract_signed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true, 'ends_on', c.contract_ends_at); END IF;
  e := (s + make_interval(months => c.plan_contract_months))::date;
  INSERT INTO company_contracts (company_id, contract_version, months, base_price_zar, included_users, extra_user_price_zar, signer_name, accepted_by, starts_on, ends_on, user_agent)
  VALUES (cid, left(coalesce(p_version,'2026-10-13'),20), c.plan_contract_months, c.plan_base_price_zar, c.plan_included_users, c.plan_extra_user_price_zar, left(btrim(p_signer_name),120), auth.uid(), s, e, left(p_user_agent,300));
  PERFORM set_config('app.plan_rpc','1',true);
  UPDATE companies SET contract_signed_at = now(), contract_signed_by = auth.uid(), contract_ends_at = e::timestamptz,
    plan_status = CASE WHEN plan_status = 'pending_contract' THEN 'active' ELSE plan_status END WHERE id = cid;
  PERFORM set_config('app.plan_rpc','0',true);
  RETURN jsonb_build_object('ok', true, 'ends_on', e);
END $$;
REVOKE ALL ON FUNCTION public.accept_company_contract(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_contract(text,text,text) TO authenticated;

-- Massair admin control: status (active / grace 7 days / suspended) and Mandy on/off. billing_live is NOT settable here.
CREATE OR REPLACE FUNCTION public.plan_admin_set(p_company uuid, p_status text, p_mandy_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)) THEN RAISE EXCEPTION 'Only Massair admins can change company plans.'; END IF;
  IF p_status NOT IN ('active','grace','suspended','cancelled','pending_contract') THEN RAISE EXCEPTION 'Unknown status %', p_status; END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE id = p_company AND is_master) AND p_status <> 'active' THEN RAISE EXCEPTION 'Massair itself always stays active.'; END IF;
  PERFORM set_config('app.plan_rpc','1',true);
  UPDATE companies SET plan_status = p_status,
    plan_grace_until = CASE WHEN p_status='grace' THEN coalesce(plan_grace_until, now() + interval '7 days') WHEN p_status='active' THEN NULL ELSE plan_grace_until END,
    mandy_enabled = CASE WHEN p_status IN ('suspended','cancelled') THEN false ELSE coalesce(p_mandy_enabled, mandy_enabled) END
  WHERE id = p_company;
  PERFORM set_config('app.plan_rpc','0',true);
  INSERT INTO nl_audit_log (user_id, company_id, tool_name, args, result, status, resource_type)
    VALUES (auth.uid(), p_company, 'plan_admin_set', jsonb_build_object('status',p_status,'mandy_enabled',p_mandy_enabled), '{}'::jsonb, 'success', 'company_plan');
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.plan_admin_set(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_admin_set(uuid,text,boolean) TO authenticated;

-- Massair admin overview: users, usage this month, monthly price (R4,500 up to 3 users + R149 each extra).
CREATE OR REPLACE FUNCTION public.plan_admin_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; m date := date_trunc('month', (now() AT TIME ZONE 'Africa/Johannesburg'))::date;
BEGIN
  IF NOT (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role)) THEN RAISE EXCEPTION 'Only Massair admins can see company plans.'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'company'), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('company_id', c.id, 'company', btrim(c.name), 'is_master', c.is_master,
      'plan_status', c.plan_status, 'mandy_enabled', c.mandy_enabled, 'billing_live', c.billing_live,
      'grace_until', c.plan_grace_until, 'contract_signed_at', c.contract_signed_at, 'contract_ends_at', c.contract_ends_at,
      'users', u.n, 'base', c.plan_base_price_zar, 'included', c.plan_included_users, 'extra_price', c.plan_extra_user_price_zar,
      'monthly_zar', c.plan_base_price_zar + greatest(u.n - c.plan_included_users, 0) * c.plan_extra_user_price_zar,
      'commands_month', coalesce(mu.cmd,0), 'tts_calls_month', coalesce(mu.tts,0), 'tts_chars_month', coalesce(mu.chars,0)) AS x
    FROM companies c
    CROSS JOIN LATERAL (SELECT count(*)::int n FROM profiles p WHERE p.company_id = c.id) u
    LEFT JOIN LATERAL (SELECT sum(commands) cmd, sum(tts_calls) tts, sum(tts_chars) chars FROM mandy_usage z WHERE z.company_id=c.id AND z.day >= m) mu ON true) s;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.plan_admin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_admin_overview() TO authenticated;

-- Daily enforcement: only acts when billing_live = true (OFF everywhere today, so a no-op).
-- grace past 7 days -> suspended + Mandy off. Massair (master) never touched.
CREATE OR REPLACE FUNCTION public.plan_enforce_daily() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  UPDATE companies SET plan_status = 'suspended', mandy_enabled = false
   WHERE billing_live AND NOT is_master AND plan_status = 'grace' AND plan_grace_until IS NOT NULL AND plan_grace_until < now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.plan_enforce_daily() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN PERFORM cron.unschedule('plan-enforce-daily'); EXCEPTION WHEN others THEN NULL; END $$;
SELECT cron.schedule('plan-enforce-daily', '15 3 * * *', 'SELECT public.plan_enforce_daily()');

-- ===== Phase 7: phone Mandy company routing (no "first company in DB" fallback) =====
CREATE TABLE IF NOT EXISTS public.phone_company_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  business_phone text, vapi_assistant_id text, is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS phone_company_routes_one_default ON public.phone_company_routes (is_default) WHERE is_default;
ALTER TABLE public.phone_company_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcr_select ON public.phone_company_routes;
CREATE POLICY pcr_select ON public.phone_company_routes FOR SELECT TO authenticated USING (public.is_master_company_user(auth.uid()) AND public.has_role(auth.uid(),'admin'::app_role));
REVOKE INSERT, UPDATE, DELETE ON public.phone_company_routes FROM anon, authenticated;
GRANT SELECT ON public.phone_company_routes TO authenticated;
-- The phone line (0800-BE-COOL / Vapi) belongs to Massair today: explicit default route.
INSERT INTO public.phone_company_routes (company_id, is_default)
  SELECT '361bf031-9cdb-4d7f-9bde-9eb95fa4725e', true WHERE NOT EXISTS (SELECT 1 FROM public.phone_company_routes WHERE is_default);

CREATE OR REPLACE FUNCTION public.phone_route_company(p_business_phone text, p_assistant_id text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT company_id FROM (
    SELECT company_id, 1 o FROM phone_company_routes WHERE p_assistant_id IS NOT NULL AND vapi_assistant_id = p_assistant_id
    UNION ALL SELECT company_id, 2 FROM phone_company_routes WHERE p_business_phone IS NOT NULL AND length(regexp_replace(p_business_phone,'\D','','g')) >= 9
      AND right(regexp_replace(business_phone,'\D','','g'),9) = right(regexp_replace(p_business_phone,'\D','','g'),9)
    UNION ALL SELECT company_id, 3 FROM phone_company_routes WHERE is_default) z ORDER BY o LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.phone_route_company(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_route_company(text,text) TO service_role;
