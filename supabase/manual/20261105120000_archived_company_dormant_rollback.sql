-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Undoes supabase/migrations/20261105120000_archived_company_dormant.sql
-- Drops dormant triggers, restrictive policies, helper functions and companies.dormant_payments_locked,
-- then restores the functions that migration replaced.

DO $$
DECLARE r record; pol text;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_dormant_company_write ON public.%I', r.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS zz_dormant_parent_write ON public.%I', r.tbl);
    FOREACH pol IN ARRAY ARRAY[
      'zz_dormant_company_ins','zz_dormant_company_upd','zz_dormant_company_del',
      'zz_dormant_parent_ins','zz_dormant_parent_upd','zz_dormant_parent_del'
    ] LOOP
      BEGIN
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, r.tbl);
      EXCEPTION WHEN undefined_object THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS zz_dormant_notification_skip ON public.notifications;
DROP TRIGGER IF EXISTS zz_ensure_company_invoice_series ON public.companies;

DROP FUNCTION IF EXISTS public.ensure_company_invoice_series();
DROP FUNCTION IF EXISTS public.confirm_dormant_payment_lock(uuid);
DROP FUNCTION IF EXISTS public.skip_inactive_company_notification();
DROP FUNCTION IF EXISTS public.enforce_parent_company_writable();
DROP FUNCTION IF EXISTS public.enforce_company_writable();
DROP FUNCTION IF EXISTS public.payment_write_ok(uuid, uuid);
DROP FUNCTION IF EXISTS public.archived_invoice_payment_ok(uuid, uuid);
DROP FUNCTION IF EXISTS public.invoice_outstanding_amount(uuid);
DROP FUNCTION IF EXISTS public.caller_is_service_role();
DROP FUNCTION IF EXISTS public.is_company_writable(uuid);

ALTER TABLE public.companies DROP COLUMN IF EXISTS dormant_payments_locked;

-- Restored from supabase/migrations/20261102200000_web_push.sql
CREATE OR REPLACE FUNCTION public.fl_alert_deliver(p_user uuid, p_type text, p_title text, p_body text, p_related uuid, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.notifications(user_id, type, title, body, related_id, metadata, read)
  VALUES (p_user, p_type, p_title, p_body, p_related, coalesce(p_meta, '{}'::jsonb), false)
  RETURNING id INTO v_id;
  IF coalesce((p_meta->>'push')::boolean, false)
     AND EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p_user) THEN
    INSERT INTO public.push_outbox(notification_id, user_id, title, body, url)
    SELECT v_id, p_user, t.title, t.body, t.url FROM public.fl_push_text(p_type, p_related) t;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fl_alert_deliver(uuid, text, text, text, uuid, jsonb) FROM PUBLIC;

-- Restored from supabase/migrations/20261009180000_p10_broadcast_fix_companies_money.sql
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


-- Restored from supabase/migrations/20260321205329_176dfa9d-2ede-4f78-a25b-384c5bbd4f71.sql
CREATE OR REPLACE FUNCTION public.trigger_auto_assign_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
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


-- Restored from supabase/migrations/20261009170000_p7_network_performance.sql
CREATE OR REPLACE FUNCTION public.network_performance(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days,30), 366))); v_out jsonb;
BEGIN
  IF NOT public.p7_is_master_admin() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  WITH cos AS (
    SELECT c.id, c.name, c.is_master FROM public.companies c
    WHERE c.is_master OR EXISTS (SELECT 1 FROM public.company_network_members m JOIN public.companies mc ON mc.id=m.master_company_id AND mc.is_master
                                 WHERE m.member_company_id=c.id AND m.status='approved')),
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
REVOKE ALL ON FUNCTION public.network_performance(integer) FROM anon;

-- Restored from docs/db-releases/2026-10-13_gwa_p5_p7.sql
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

-- Restored from supabase/migrations/20261103143000_job_type_choice.sql
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

-- Restored from supabase/migrations/20261030220000_final_invoice_email_branded.sql
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
