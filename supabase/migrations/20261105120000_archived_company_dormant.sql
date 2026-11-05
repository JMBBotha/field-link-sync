-- Rollback: supabase/manual/20261105120000_archived_company_dormant_rollback.sql
-- Dormant company = companies.status 'archived' (validate_company_status already allows
-- active | on_hold | archived). No new 'dormant' value.
--
-- is_company_writable(cid) is true only when status = 'active'. on_hold is not writable.
-- Authenticated writes to company-scoped tables are refused while the company is not active.
-- Service role still writes (history import). A SQL session can too with SET app.archived_import = 'on'.
--
-- Payments: RLS + trigger exception, not a separate RPC. INSERT/UPDATE of payments is allowed
-- for an archived company when the invoice still has outstanding > 0.005 and
-- companies.dormant_payments_locked is false. confirm_dormant_payment_lock seals that too.
-- DELETE of payments is never part of the exception.
--
-- Side-effect inserts (entity_outbox, offers, request_offers, request_alerts, notifications)
-- are skipped (the row is not written) for every role, including service role, so a dormant
-- company does not email, notify, offer or broadcast. Updates of those rows still apply so
-- a worker can mark an already-queued event done.
--
-- Invoice numbers stay per company_profiles row (invoice_prefix + next_invoice_no,
-- use_shared_sequence false). A new company gets its own profile and a primary
-- company_settings row. Banking columns already exist (company_profiles.bank_* and
-- company_settings.banking_details). Nothing here writes an account number.
--
-- Does not insert a company, does not touch existing company rows, and does not rename anyone.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS dormant_payments_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.status IS
  'active | on_hold | archived. archived is dormant / history-only. is_company_writable is true only for active.';
COMMENT ON COLUMN public.companies.dormant_payments_locked IS
  'When true on an archived company, payments on open invoices are refused too. Set by confirm_dormant_payment_lock.';

CREATE OR REPLACE FUNCTION public.is_company_writable(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND c.status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.caller_is_service_role()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  BEGIN
    IF coalesce(auth.role(), '') = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN undefined_function THEN
    RETURN false;
  END;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_outstanding_amount(p_invoice uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN i.id IS NULL THEN 0
    WHEN lower(coalesce(i.status, '')) IN ('void', 'cancelled') THEN 0
    ELSE round(
      coalesce(i.grand_total, 0)
      - coalesce((
          SELECT sum(p.amount) FROM public.payments p
          WHERE p.invoice_id = i.id AND p.status IN ('paid', 'succeeded', 'completed')
        ), 0)
      - coalesce(public.invoice_amount_credited(i.id), 0)
    , 2)
  END
  FROM public.invoices i
  WHERE i.id = p_invoice;
$$;

-- Outstanding balance on an archived, not-yet-sealed company. The check is the balance
-- before this payment row is written, so the payment that clears the invoice still lands.
CREATE OR REPLACE FUNCTION public.archived_invoice_payment_ok(p_company uuid, p_invoice uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_company IS NOT NULL AND p_invoice IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.companies c
    JOIN public.invoices i ON i.id = p_invoice AND i.company_id = c.id
    WHERE c.id = p_company
      AND c.status = 'archived'
      AND NOT c.dormant_payments_locked
      AND public.invoice_outstanding_amount(i.id) > 0.005
  );
$$;

-- A payment row with a blank company_id still follows its invoice. Null company and null
-- invoice stays allowed (nothing to scope).
CREATE OR REPLACE FUNCTION public.payment_write_ok(p_company uuid, p_invoice uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (p_company IS NOT NULL AND public.is_company_writable(p_company))
    OR public.archived_invoice_payment_ok(
         coalesce(p_company, (SELECT i.company_id FROM public.invoices i WHERE i.id = p_invoice)),
         p_invoice)
    OR (
      p_company IS NULL AND p_invoice IS NOT NULL AND public.is_company_writable(
        (SELECT i.company_id FROM public.invoices i WHERE i.id = p_invoice))
    )
    OR (p_company IS NULL AND p_invoice IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.enforce_company_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
  inv uuid;
  skip_insert boolean := TG_TABLE_NAME = ANY (ARRAY['entity_outbox', 'offers', 'request_offers', 'request_alerts']);
BEGIN
  IF skip_insert THEN
    IF TG_OP = 'INSERT' THEN
      cid := NEW.company_id;
      IF cid IS NOT NULL AND NOT public.is_company_writable(cid) THEN
        RETURN NULL;
      END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'payments' AND TG_OP IN ('INSERT', 'UPDATE') THEN
    cid := NEW.company_id;
    inv := NEW.invoice_id;
    IF public.payment_write_ok(cid, inv) THEN
      RETURN NEW;
    END IF;
    IF public.caller_is_service_role() OR coalesce(current_setting('app.archived_import', true), '') = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Company is archived (history only). Payments are allowed only while an invoice still has a balance, until an admin locks them.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'payments' AND TG_OP = 'DELETE' AND OLD.company_id IS NULL AND OLD.invoice_id IS NOT NULL THEN
    SELECT i.company_id INTO cid FROM public.invoices i WHERE i.id = OLD.invoice_id;
    IF cid IS NOT NULL AND NOT public.is_company_writable(cid)
       AND NOT public.caller_is_service_role()
       AND coalesce(current_setting('app.archived_import', true), '') <> 'on' THEN
      RAISE EXCEPTION 'This company is not active. DELETE on payments is not allowed.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  IF TG_OP = 'UPDATE'
     AND OLD.company_id IS NOT NULL
     AND NOT public.is_company_writable(OLD.company_id)
     AND NOT public.caller_is_service_role()
     AND coalesce(current_setting('app.archived_import', true), '') <> 'on' THEN
    RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF cid IS NULL OR public.is_company_writable(cid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.caller_is_service_role() OR coalesce(current_setting('app.archived_import', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_parent_company_writable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk_name text := TG_ARGV[0];
  parent_table text := TG_ARGV[1];
  mode text := coalesce(TG_ARGV[2], 'raise');
  rowj jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  fk uuid := nullif(rowj ->> fk_name, '')::uuid;
  cid uuid;
BEGIN
  IF fk IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  EXECUTE format('SELECT company_id FROM public.%I WHERE id = $1', parent_table) INTO cid USING fk;
  IF cid IS NULL OR public.is_company_writable(cid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF mode = 'skip' AND TG_OP = 'INSERT' THEN
    RETURN NULL;
  END IF;
  IF mode = 'skip' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF public.caller_is_service_role() OR coalesce(current_setting('app.archived_import', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

-- Notifications have no company_id. Skip the insert when the related record belongs to a company that is not active.
CREATE OR REPLACE FUNCTION public.skip_inactive_company_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  cid := nullif(NEW.metadata ->> 'company_id', '')::uuid;
  IF cid IS NULL AND NEW.related_id IS NOT NULL THEN
    SELECT l.company_id INTO cid FROM public.leads l WHERE l.id = NEW.related_id;
    IF cid IS NULL THEN SELECT j.company_id INTO cid FROM public.jobs j WHERE j.id = NEW.related_id; END IF;
    IF cid IS NULL THEN SELECT q.company_id INTO cid FROM public.quotes q WHERE q.id = NEW.related_id; END IF;
    IF cid IS NULL THEN SELECT i.company_id INTO cid FROM public.invoices i WHERE i.id = NEW.related_id; END IF;
    IF cid IS NULL THEN SELECT c.company_id INTO cid FROM public.customers c WHERE c.id = NEW.related_id; END IF;
    IF cid IS NULL THEN
      SELECT i.company_id INTO cid
      FROM public.payments p
      JOIN public.invoices i ON i.id = p.invoice_id
      WHERE p.id = NEW.related_id;
    END IF;
  END IF;
  IF cid IS NOT NULL AND NOT public.is_company_writable(cid) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.is_company_writable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_is_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoice_outstanding_amount(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archived_invoice_payment_ok(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_write_ok(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_writable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_outstanding_amount(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archived_invoice_payment_ok(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_write_ok(uuid, uuid) TO authenticated, service_role;

-- Append-only logs stay writable so a payment that is allowed can still be audited.
-- Views are not tables. The companies row itself is not locked, so an admin can archive and restore it.
DO $$
DECLARE
  r record;
  pol text;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, c.relrowsecurity AS rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND a.atttypid = 'uuid'::regtype AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'companies'
      AND c.relname NOT IN (
        'audit_log', 'assistant_audit_logs', 'bot_audit_log', 'nl_audit_log',
        'status_change_log', 'lead_assignment_log', 'quote_aging_log',
        'quote_lock_events', 'quote_stage_events', 'payment_events',
        'pdf_activity', 'mandy_usage', 'mandy_voice_logs', 'webhook_dead_letters',
        'customer_owner_rep_log'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_dormant_company_write ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER zz_dormant_company_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_company_writable()',
      r.tbl
    );

    IF r.rls AND r.tbl <> 'payments' THEN
      FOREACH pol IN ARRAY ARRAY['zz_dormant_company_ins', 'zz_dormant_company_upd', 'zz_dormant_company_del']
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.tbl);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY zz_dormant_company_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (company_id IS NULL OR public.is_company_writable(company_id))',
        r.tbl
      );
      EXECUTE format(
        'CREATE POLICY zz_dormant_company_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (company_id IS NULL OR public.is_company_writable(company_id)) WITH CHECK (company_id IS NULL OR public.is_company_writable(company_id))',
        r.tbl
      );
      EXECUTE format(
        'CREATE POLICY zz_dormant_company_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (company_id IS NULL OR public.is_company_writable(company_id))',
        r.tbl
      );
    END IF;
  END LOOP;
END $$;

-- Payments: same trigger (exception is inside the function). Policies allow the open-invoice exception.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'payments' AND c.relrowsecurity
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS zz_dormant_company_ins ON public.payments';
    EXECUTE 'DROP POLICY IF EXISTS zz_dormant_company_upd ON public.payments';
    EXECUTE 'DROP POLICY IF EXISTS zz_dormant_company_del ON public.payments';
    EXECUTE $p$CREATE POLICY zz_dormant_company_ins ON public.payments AS RESTRICTIVE FOR INSERT TO authenticated, anon
      WITH CHECK (public.payment_write_ok(company_id, invoice_id))$p$;
    EXECUTE $p$CREATE POLICY zz_dormant_company_upd ON public.payments AS RESTRICTIVE FOR UPDATE TO authenticated, anon
      USING (public.payment_write_ok(company_id, invoice_id))
      WITH CHECK (public.payment_write_ok(company_id, invoice_id))$p$;
    EXECUTE $p$CREATE POLICY zz_dormant_company_del ON public.payments AS RESTRICTIVE FOR DELETE TO authenticated, anon
      USING (
        (company_id IS NOT NULL AND public.is_company_writable(company_id))
        OR (company_id IS NULL AND invoice_id IS NULL)
        OR (company_id IS NULL AND invoice_id IS NOT NULL AND public.is_company_writable((SELECT i.company_id FROM public.invoices i WHERE i.id = invoice_id)))
      )$p$;
  END IF;
END $$;

-- Child tables with no company_id of their own (invoice_items, quote_items, and the rest).
DO $$
DECLARE
  r record;
  mode text;
  pol text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (c.relname)
      c.relname AS tbl,
      a.attname AS fk,
      CASE a.attname
        WHEN 'invoice_id' THEN 'invoices'
        WHEN 'quote_id' THEN 'quotes'
        WHEN 'job_id' THEN 'jobs'
        WHEN 'lead_id' THEN 'leads'
        ELSE 'customers'
      END AS parent,
      c.relrowsecurity AS rls,
      CASE a.attname
        WHEN 'invoice_id' THEN 1
        WHEN 'quote_id' THEN 2
        WHEN 'job_id' THEN 3
        WHEN 'lead_id' THEN 4
        ELSE 5
      END AS pri
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
      AND a.attname IN ('invoice_id', 'quote_id', 'job_id', 'lead_id', 'customer_id')
      AND a.atttypid = 'uuid'::regtype
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute co
        WHERE co.attrelid = c.oid AND co.attname = 'company_id' AND NOT co.attisdropped
      )
    ORDER BY c.relname, pri
  LOOP
    mode := CASE WHEN r.tbl = 'communication_log' THEN 'skip' ELSE 'raise' END;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_dormant_parent_write ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER zz_dormant_parent_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_parent_company_writable(%L, %L, %L)',
      r.tbl, r.fk, r.parent, mode
    );
    IF r.rls AND mode = 'raise' THEN
      FOREACH pol IN ARRAY ARRAY['zz_dormant_parent_ins', 'zz_dormant_parent_upd', 'zz_dormant_parent_del']
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.tbl);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY zz_dormant_parent_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (%I IS NULL OR EXISTS (SELECT 1 FROM public.%I parent WHERE parent.id = %I AND (parent.company_id IS NULL OR public.is_company_writable(parent.company_id))))',
        r.tbl, r.fk, r.parent, r.fk
      );
      EXECUTE format(
        'CREATE POLICY zz_dormant_parent_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (%I IS NULL OR EXISTS (SELECT 1 FROM public.%I parent WHERE parent.id = %I AND (parent.company_id IS NULL OR public.is_company_writable(parent.company_id)))) WITH CHECK (%I IS NULL OR EXISTS (SELECT 1 FROM public.%I parent WHERE parent.id = %I AND (parent.company_id IS NULL OR public.is_company_writable(parent.company_id))))',
        r.tbl, r.fk, r.parent, r.fk, r.fk, r.parent, r.fk
      );
      EXECUTE format(
        'CREATE POLICY zz_dormant_parent_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (%I IS NULL OR EXISTS (SELECT 1 FROM public.%I parent WHERE parent.id = %I AND (parent.company_id IS NULL OR public.is_company_writable(parent.company_id))))',
        r.tbl, r.fk, r.parent, r.fk
      );
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS zz_dormant_notification_skip ON public.notifications;
CREATE TRIGGER zz_dormant_notification_skip
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.skip_inactive_company_notification();

-- fl_alert_deliver must not continue into push when the notification insert was skipped.
CREATE OR REPLACE FUNCTION public.fl_alert_deliver(p_user uuid, p_type text, p_title text, p_body text, p_related uuid, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF nullif(p_meta->>'company_id', '') IS NOT NULL
     AND NOT public.is_company_writable((p_meta->>'company_id')::uuid) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications(user_id, type, title, body, related_id, metadata, read)
  VALUES (p_user, p_type, p_title, p_body, p_related, coalesce(p_meta, '{}'::jsonb), false)
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF coalesce((p_meta->>'push')::boolean, false)
     AND EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p_user) THEN
    INSERT INTO public.push_outbox(notification_id, user_id, title, body, url)
    SELECT v_id, p_user, t.title, t.body, t.url FROM public.fl_push_text(p_type, p_related) t;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fl_alert_deliver(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- Broadcast and the auto-assign webhook do nothing for a company that is not active.
CREATE OR REPLACE FUNCTION public.broadcast_lead_to_agents(p_lead_id uuid, p_radius_km numeric DEFAULT 30)
RETURNS TABLE(agent_id uuid, distance_km numeric, offer_method text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_company_id uuid;
  v_primary_intent public.lead_intent;
  v_dispatch_role text;
BEGIN
  SELECT l.company_id, l.primary_intent INTO v_company_id, v_primary_intent
  FROM public.leads l WHERE l.id = p_lead_id;

  IF NOT public.is_company_writable(v_company_id) THEN
    RETURN;
  END IF;

  IF NOT public.rh_ops_ok(v_company_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_primary_intent IS NULL THEN RETURN; END IF;

  v_dispatch_role := CASE WHEN v_primary_intent = 'sales' THEN 'sales' ELSE 'technician' END;

  RETURN QUERY
  WITH candidates AS (
    SELECT c.staff_id AS cand_id, c.distance_km AS cand_km
    FROM public.find_dispatch_candidates(p_lead_id, v_dispatch_role, p_radius_km, NULL) c
    WHERE v_dispatch_role <> 'technician'
       OR EXISTS (SELECT 1 FROM public._tech_offer_fit(c.staff_id, p_lead_id) f WHERE f.fits)
  ), ins AS (
    INSERT INTO public.offers AS o (lead_id, staff_id, company_id, offer_type, sequence, status, distance_km, expires_at)
    SELECT p_lead_id, c.cand_id, v_company_id,
           CASE WHEN v_dispatch_role = 'sales' THEN 'sales_estimate' ELSE 'service_call' END, 1, 'pending', c.cand_km, now() + interval '15 minutes'
    FROM candidates c
    WHERE NOT EXISTS (SELECT 1 FROM public.offers x
                      WHERE x.lead_id = p_lead_id AND x.staff_id = c.cand_id AND x.status = 'pending')
    RETURNING o.staff_id AS out_id, o.distance_km AS out_km
  )
  SELECT ins.out_id, ins.out_km, 'broadcast'::text FROM ins;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_auto_assign_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_company_writable(NEW.company_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.latitude IS NOT NULL AND NEW.latitude != 0
     AND NEW.longitude IS NOT NULL AND NEW.longitude != 0
     AND NEW.status IN ('pending', 'new')
     AND NEW.assigned_agent_id IS NULL THEN
    PERFORM net.http_post(
      url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/auto-assign-lead',
      body := jsonb_build_object('lead_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-api-key', 'becool-webhook-2026-secure'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Network roll-up: same shape as p7, plus status = active (network_company_names already filters).
CREATE OR REPLACE FUNCTION public.network_performance(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days,30), 366))); v_out jsonb;
BEGIN
  IF NOT public.p7_is_master_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  WITH cos AS (
    SELECT c.id, c.name, c.is_master FROM public.companies c
    WHERE c.status = 'active'
      AND (c.is_master OR EXISTS (SELECT 1 FROM public.company_network_members m JOIN public.companies mc ON mc.id=m.master_company_id AND mc.is_master
                                 WHERE m.member_company_id=c.id AND m.status='approved'))),
  agg AS (
    SELECT cos.id, cos.name, cos.is_master,
      (SELECT count(*) FROM public.leads l WHERE l.company_id=cos.id AND l.created_at >= v_from AND l.deleted_at IS NULL AND l.merged_into_id IS NULL) AS leads_new,
      (SELECT count(*) FROM public.leads l WHERE l.company_id=cos.id AND l.completed_at >= v_from) AS leads_completed,
      (SELECT count(*) FROM public.quotes q WHERE q.company_id=cos.id AND q.created_at >= v_from AND q.status IN ('sent','viewed','accepted')) AS quotes_sent,
      (SELECT count(*) FROM public.quotes q WHERE q.company_id=cos.id AND q.created_at >= v_from AND q.status = 'accepted') AS quotes_accepted,
      (SELECT COALESCE(round(sum(q.total)::numeric, 2), 0) FROM public.quotes q WHERE q.company_id=cos.id AND q.created_at >= v_from AND q.status = 'accepted') AS accepted_value,
      (SELECT count(*) FROM public.jobs j WHERE j.company_id=cos.id AND j.created_at >= v_from AND j.status <> 'cancelled') AS jobs_booked,
      (SELECT count(DISTINCT p.id) FROM public.profiles p WHERE p.company_id=cos.id AND p.archived_at IS NULL) AS people
    FROM cos)
  SELECT jsonb_build_object('days', GREATEST(1, LEAST(COALESCE(p_days,30), 366)), 'companies',
    COALESCE(jsonb_agg(jsonb_build_object('company_id', id, 'name', name, 'is_master', is_master, 'leads_new', leads_new, 'leads_completed', leads_completed,
      'quotes_sent', quotes_sent, 'quotes_accepted', quotes_accepted, 'accepted_value', accepted_value, 'jobs_booked', jobs_booked, 'people', people,
      'win_rate', CASE WHEN quotes_sent > 0 THEN round(100.0 * quotes_accepted / quotes_sent) END) ORDER BY is_master DESC, name), '[]'::jsonb)) INTO v_out FROM agg;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.network_performance(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_performance(integer) TO authenticated;

-- Billing roster only. Owner money overview (parent_overview) still includes archived companies
-- so open invoice balances stay visible.
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
    LEFT JOIN LATERAL (SELECT sum(commands) cmd, sum(tts_calls) tts, sum(tts_chars) chars FROM mandy_usage z WHERE z.company_id=c.id AND z.day >= m) mu ON true
    WHERE c.status = 'active') s;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.plan_admin_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_admin_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_dormant_payment_lock(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_platform_owner() OR public.is_company_owner(auth.uid(), p_company)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company AND status = 'archived') THEN
    RAISE EXCEPTION 'Only an archived company can be locked';
  END IF;
  UPDATE public.companies
     SET dormant_payments_locked = true, updated_at = now()
   WHERE id = p_company;
  RETURN jsonb_build_object('ok', true, 'company_id', p_company, 'dormant_payments_locked', true);
END $$;
REVOKE ALL ON FUNCTION public.confirm_dormant_payment_lock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_dormant_payment_lock(uuid) TO authenticated;

-- Own invoice series for every company created after this migration. Existing rows are left alone.
-- Prefix is derived from the name and kept unique because invoice_number is unique across companies.
-- use_shared_sequence stays false so it never consumes the shared INV- sequence. Bank fields stay empty.
CREATE OR REPLACE FUNCTION public.ensure_company_invoice_series()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  n int := 0;
  candidate text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.company_profiles WHERE company_id = NEW.id AND archived_at IS NULL) THEN
    RETURN NEW;
  END IF;
  prefix := upper(left(regexp_replace(coalesce(nullif(btrim(NEW.slug), ''), NEW.name), '[^A-Za-z0-9]', '', 'g'), 6));
  IF coalesce(length(prefix), 0) < 2 THEN
    prefix := 'CO';
  END IF;
  candidate := prefix || '-';
  WHILE EXISTS (
    SELECT 1 FROM public.company_profiles WHERE invoice_prefix = candidate AND archived_at IS NULL
  ) LOOP
    n := n + 1;
    candidate := prefix || n::text || '-';
  END LOOP;
  INSERT INTO public.company_profiles (
    company_id, legal_name, invoice_prefix, use_shared_sequence, next_invoice_no, number_pad, is_default
  ) VALUES (
    NEW.id, NEW.name, candidate, false, 1, 4, true
  );
  IF NOT EXISTS (SELECT 1 FROM public.company_settings WHERE company_id = NEW.id) THEN
    INSERT INTO public.company_settings (company_id, company_name, is_primary, banking_details)
    VALUES (NEW.id, NEW.name, true, '{}'::jsonb);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_ensure_company_invoice_series ON public.companies;
CREATE TRIGGER zz_ensure_company_invoice_series
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.ensure_company_invoice_series();

-- Booking confirmation email: send mode does nothing when the company is not active. Preview still returns the text.
CREATE OR REPLACE FUNCTION public.send_booking_confirmation(p_job_id uuid, p_mode text DEFAULT 'preview', p_to text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); j record; v_kind text; v_msg jsonb; v_to text; v_token uuid; v_req bigint;
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_mode NOT IN ('preview','send') THEN RAISE EXCEPTION 'Unknown mode'; END IF;
  SELECT jb.id, jb.company_id, jb.job_type, jb.scheduled_for, c.name, c.email, co.name AS company
    INTO j FROM public.jobs jb LEFT JOIN public.customers c ON c.id = jb.customer_id LEFT JOIN public.companies co ON co.id = jb.company_id
   WHERE jb.id = p_job_id;
  IF j.id IS NULL OR NOT public.fl_is_company_admin(v_uid, j.company_id) THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF p_mode = 'send' AND NOT public.is_company_writable(j.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_archived');
  END IF;
  IF j.scheduled_for IS NULL THEN RAISE EXCEPTION 'Book a date and time first'; END IF;
  v_kind := CASE WHEN j.job_type IN ('service','service_call','repair','maintenance') THEN 'service' ELSE 'installation' END;
  v_msg := public._booking_email(split_part(coalesce(j.name,''),' ',1), v_kind, j.scheduled_for, j.company);
  v_to := lower(btrim(coalesce(nullif(btrim(p_to),''), j.email, '')));
  IF p_mode = 'preview' THEN RETURN v_msg || jsonb_build_object('ok', true, 'to', v_to, 'call_out', v_kind = 'service'); END IF;
  IF v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'No valid email address'; END IF;
  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not set up'; END IF;
  SELECT net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_msg->>'subject', 'html', v_msg->>'html', 'signature_mode', 'company', 'sender_user_id', v_uid::text, 'company_id', j.company_id)) INTO v_req;
  INSERT INTO public.email_events (email_id, event_type, recipient_email, event_data)
  VALUES ('net:' || v_req::text, 'booking_confirmation_queued', v_to, jsonb_build_object('job_id', j.id, 'call_out', v_kind = 'service', 'net_request_id', v_req, 'by', v_uid));
  RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_msg->>'subject', 'net_request_id', v_req, 'sent_at', now());
END $$;
REVOKE ALL ON FUNCTION public.send_booking_confirmation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_booking_confirmation(uuid, text, text) TO authenticated;

-- Final invoice email: send and test do nothing when the company is not active. Preview still returns the text.
CREATE OR REPLACE FUNCTION public.send_final_invoice_email(p_invoice uuid, p_to text DEFAULT NULL, p_mode text DEFAULT 'preview')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid(); inv public.invoices%ROWTYPE;
  v_paid numeric; v_bal numeric; v_to text; v_name text; v_subject text; v_html text; v_terms text;
  v_tok uuid; v_link text; v_token uuid; v_req bigint; v_log jsonb; v_snap jsonb; v_legal text; v_acc text;
  v_app_url text := 'https://field-link-sync.lovable.app';
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
  v_layout jsonb; v_logo text; v_phone text; v_due text; v_lines jsonb;
  v_owner boolean; v_admin boolean; v_rep boolean; v_office boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_mode NOT IN ('preview','send','test') THEN RAISE EXCEPTION 'Unknown mode'; END IF;
  SELECT * INTO inv FROM invoices WHERE id = p_invoice;
  IF inv.id IS NULL OR inv.company_id IS DISTINCT FROM public.get_user_company_id(v_uid) THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  v_owner := coalesce(public.is_company_owner(v_uid, inv.company_id), false);
  v_admin := public.has_role(v_uid, 'admin') OR EXISTS (SELECT 1 FROM company_members WHERE user_id = v_uid AND company_id = inv.company_id AND role = 'admin');
  v_rep := public.is_sales_rep(v_uid);
  v_office := public.has_role(v_uid, 'dispatcher') AND NOT v_rep;
  IF NOT (v_owner OR v_admin OR v_office OR (v_rep AND coalesce(public.rep_can_see_invoice(v_uid, p_invoice), false))) THEN
    RAISE EXCEPTION 'You are not allowed to send this invoice'; END IF;
  IF inv.status IN ('draft','void','cancelled') THEN RAISE EXCEPTION 'Invoice is %', inv.status; END IF;
  IF p_mode IN ('send', 'test') AND NOT public.is_company_writable(inv.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_archived');
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_paid FROM payments WHERE invoice_id = inv.id AND status = 'paid';
  v_bal := greatest(round(coalesce(inv.grand_total,0) - v_paid, 2), 0);
  v_to := lower(btrim(coalesce(nullif(btrim(p_to),''), inv.customer_email, (SELECT email FROM customers WHERE id = inv.customer_id))));
  IF v_to IS NULL OR v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'No valid email address for this client'; END IF;
  v_name := replace(replace(coalesce(nullif(btrim(inv.customer_name),''), 'Valued Customer'),'<','&lt;'),'>','&gt;');
  v_snap := coalesce(inv.profile_snapshot, '{}'::jsonb);
  v_legal := coalesce(nullif(v_snap->>'legal_name',''), 'Massair CT (Pty) Ltd');
  v_terms := replace(replace(replace(coalesce(v_snap->>'terms_text',''),'&','&amp;'),'<','&lt;'),'>','&gt;');
  -- Never Ind CC, never the old 0800 number as text (Johan).
  v_legal := regexp_replace(v_legal, '\s*Ind\.?\s*CC', ' (Pty) Ltd', 'gi');
  v_terms := regexp_replace(regexp_replace(v_terms, '\s*Ind\.?\s*CC', ' (Pty) Ltd', 'gi'), '0800[\s-]*232[\s-]*665', '', 'g');
  v_terms := replace(v_terms, E'\n', '<br/>');
  v_subject := 'Final invoice ' || coalesce(inv.invoice_number,'') || ' - balance ' || public.fmt_rand_sql(v_bal);
  IF p_mode = 'test' THEN v_subject := '[TEST] ' || v_subject; END IF;

  IF p_mode <> 'preview' AND inv.customer_id IS NOT NULL THEN
    SELECT token INTO v_tok FROM customer_tokens WHERE customer_id = inv.customer_id AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1;
    IF v_tok IS NULL THEN INSERT INTO customer_tokens (customer_id) VALUES (inv.customer_id) RETURNING token INTO v_tok; END IF;
  END IF;
  v_link := CASE WHEN v_tok IS NOT NULL THEN v_app_url || '/customer/' || v_tok || '/invoice/' || inv.id
                 WHEN p_mode = 'preview' THEN v_app_url || '/customer/…/invoice/' || inv.id END;

  v_html := '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    || '<body style="margin:0;padding:0;background-color:#eef3f9;font-family:Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">'
    || '<tr><td style="background:#0B4FA8;padding:22px 28px;text-align:center;"><h1 style="margin:0;font-size:20px;color:#ffffff;">' || v_legal || '</h1>'
    || '<p style="margin:4px 0 0;font-size:11px;color:#dbeafe;letter-spacing:1px;text-transform:uppercase;">Final invoice ' || coalesce(inv.invoice_number,'') || '</p></td></tr>'
    || '<tr><td style="background:#F7941D;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    || '<tr><td style="padding:24px 28px;">'
    || '<p style="margin:0 0 14px;font-size:15px;color:#111827;">Dear <strong>' || v_name || '</strong>,</p>'
    || '<p style="margin:0 0 18px;font-size:14px;color:#374151;">Thank you, the work is done. Here is the final invoice <strong>' || coalesce(inv.invoice_number,'') || '</strong> for the balance.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:18px;"><tr><td style="padding:16px 20px;">'
    || '<p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;">Balance due (incl. VAT)</p>'
    || '<p style="margin:4px 0 0;font-size:26px;font-weight:800;color:#0B4FA8;">' || public.fmt_rand_sql(v_bal) || '</p>'
    || CASE WHEN inv.due_date IS NOT NULL THEN '<p style="margin:4px 0 0;font-size:14px;color:#111827;">Due ' || to_char(inv.due_date, 'FMDD FMMonth YYYY') || '</p>' ELSE '' END
    || '<p style="margin:6px 0 0;font-size:12px;color:#6b7280;">Invoice total ' || public.fmt_rand_sql(coalesce(inv.grand_total,0)) || ' · already paid ' || public.fmt_rand_sql(v_paid) || '</p></td></tr></table>'
    || CASE WHEN v_link IS NOT NULL THEN '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 12px;"><tr><td style="background:#F7941D;border-radius:8px;"><a href="' || v_link || '" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#0B4FA8;text-decoration:none;">View &amp; pay your invoice</a></td></tr></table>'
      || '<p style="margin:0 0 16px;font-size:12px;color:#6b7280;word-break:break-all;">Or open: <a href="' || v_link || '" style="color:#0B4FA8;">' || v_link || '</a></p>' ELSE '' END
    || '<p style="margin:0 0 6px;font-size:14px;color:#111827;"><strong>Pay by EFT</strong> · use <strong>' || coalesce(inv.invoice_number,'') || '</strong> as the reference</p>'
    || '<p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.6;">' || v_legal
    || coalesce('<br/>' || nullif(v_snap->>'bank_name',''), '') || coalesce(' · Acc ' || nullif(v_snap->>'account_number',''), '')
    || coalesce(' · Branch ' || nullif(v_snap->>'branch_code',''), '') || coalesce(' · ' || nullif(v_snap->>'account_type',''), '')
    || coalesce('<br/>VAT ' || nullif(v_snap->>'vat_number',''), '') || '</p>'
    || CASE WHEN v_terms <> '' THEN '<p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;">Terms</p><p style="margin:0 0 12px;font-size:12px;color:#6b7280;line-height:1.5;">' || v_terms || '</p>' ELSE '' END
    || '</td></tr></table></td></tr></table></body></html>';

  -- Shared layout payload (V8 blue header + white Massair logo from the public https /email folder).
  SELECT CASE WHEN v_legal ~* '^massair ct' THEN v_app_url || '/email/logo-white.png' ELSE nullif(cp.logo_url,'') END,
         nullif(regexp_replace(coalesce(nullif(v_snap->>'phone',''), cp.phone, ''), '0800[\s-]*232[\s-]*665', '', 'g'),'')
    INTO v_logo, v_phone
    FROM (SELECT 1) x LEFT JOIN LATERAL (SELECT logo_url, phone FROM company_profiles WHERE company_id = inv.company_id AND archived_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1) cp ON true;
  IF v_phone IS NULL AND v_legal ~* '^massair ct' THEN v_phone := '(021) 802-2889'; END IF;
  v_due := CASE WHEN inv.due_date IS NOT NULL THEN to_char(inv.due_date, 'FMDD FMMonth YYYY') END;
  v_lines := jsonb_build_array(v_legal,
    concat_ws(' · ', nullif(v_snap->>'bank_name',''), 'Acc ' || nullif(v_snap->>'account_number',''), 'Branch ' || nullif(v_snap->>'branch_code',''), nullif(v_snap->>'account_type','')),
    'Reference: ' || coalesce(inv.invoice_number,''));
  v_layout := jsonb_build_object('template','final_invoice', 'title', v_subject, 'kicker', 'Your final invoice is ready',
    'greeting_name', inv.customer_name,
    'brand', jsonb_build_object('name', v_legal, 'logoUrl', v_logo, 'logoOnColour', v_legal ~* '^massair ct',
      'topParts', jsonb_build_array(v_legal, 'VAT ' || nullif(v_snap->>'vat_number',''), 'Tel ' || v_phone, nullif(v_snap->>'email',''))),
    'data', jsonb_build_object('invoiceNumber', inv.invoice_number, 'dueDate', v_due,
      'total', public.fmt_rand_sql(coalesce(inv.grand_total,0)), 'paid', public.fmt_rand_sql(v_paid), 'balance', public.fmt_rand_sql(v_bal),
      'link', v_link, 'companyLines', v_lines, 'termsHtml', nullif(v_terms,'')));
  v_layout := jsonb_strip_nulls(v_layout);

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'html', v_html, 'layout', v_layout, 'balance', v_bal, 'final_sent_at', inv.final_sent_at, 'final_sent_channel', inv.final_sent_channel);
  END IF;

  IF p_mode = 'send' AND inv.final_sent_at IS NOT NULL AND inv.final_sent_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'final_sent_at', inv.final_sent_at, 'to', v_to);
  END IF;

  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not set up'; END IF;
  SELECT net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', v_html, 'layout', v_layout, 'signature_mode', 'person', 'sender_user_id', v_uid::text, 'company_id', inv.company_id)
  ) INTO v_req;
  INSERT INTO public.email_events (email_id, event_type, recipient_email, event_data)
  VALUES ('net:' || v_req::text, CASE WHEN p_mode = 'test' THEN 'final_invoice_email_test' ELSE 'final_invoice_email_queued' END, v_to,
    jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'net_request_id', v_req, 'by', v_uid, 'balance', v_bal));

  IF p_mode = 'test' THEN
    RETURN jsonb_build_object('ok', true, 'test', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'sent_at', now());
  END IF;

  v_log := public.log_final_invoice_send(inv.id, 'email', 'confirmed', 'Emailed to ' || v_to);
  SELECT nullif(btrim(accounts_email),'') INTO v_acc FROM companies WHERE id = inv.company_id;
  IF v_acc IS NOT NULL AND lower(v_acc) <> v_to THEN
    PERFORM net.http_post(url := v_fn_url,
      headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
      body := jsonb_build_object('to', v_acc, 'subject', '[Copy] ' || v_subject, 'html', v_html, 'layout', v_layout, 'signature_mode', 'person', 'sender_user_id', v_uid::text, 'company_id', inv.company_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'final_sent_at', coalesce(v_log->>'final_sent_at', now()::text), 'channel', 'email');
END $function$;
REVOKE ALL ON FUNCTION public.send_final_invoice_email(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_final_invoice_email(uuid, text, text) TO authenticated;
