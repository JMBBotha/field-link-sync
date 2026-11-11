-- Client-facing amount due now. Email box and the public invoice read share invoice_due_now.
-- Existing invoice amounts are not updated.

-- Amount due today on a full-value invoice. Does not write invoice rows.
-- Deposit is due on send unless expected_deposit_date is still in the future.
-- The remainder is due only on the expected final date, a hand-set due date, or job completion.
-- A terms-only date is not a demand for the balance.

CREATE OR REPLACE FUNCTION public.invoice_due_now(p_invoice uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.invoices%ROWTYPE;
  v_paid numeric := 0;
  v_cred numeric := 0;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_dep numeric;
  v_total numeric;
  v_dep_out numeric;
  v_fin_out numeric;
  v_fin_date date;
  v_due numeric := 0;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF lower(coalesce(i.status, '')) IN ('void', 'cancelled', 'paid') THEN RETURN 0; END IF;
  v_total := round(coalesce(i.grand_total, 0), 2);
  SELECT coalesce(sum(amount), 0) INTO v_paid
    FROM public.payments
   WHERE invoice_id = p_invoice AND status IN ('paid', 'succeeded', 'completed');
  IF to_regclass('public.credit_notes') IS NOT NULL THEN
    SELECT coalesce(sum(total), 0) INTO v_cred
      FROM public.credit_notes
     WHERE invoice_id = p_invoice AND coalesce(status, '') <> 'void';
  END IF;
  v_dep := round(coalesce(i.deposit_amount, 0), 2);
  IF v_dep > 0.005 AND v_dep < v_total - 0.005 AND coalesce(i.deposit_type, '') <> 'deposit_invoice' THEN
    v_dep_out := greatest(0, round(v_dep - least(v_paid, v_dep), 2));
    v_fin_out := greatest(0, round(greatest(0, v_total - v_dep - v_cred) - greatest(v_paid - v_dep, 0), 2));
    IF i.expected_deposit_date IS NULL OR i.expected_deposit_date <= v_today THEN
      v_due := v_due + v_dep_out;
    END IF;
    v_fin_date := COALESCE(i.expected_final_date, CASE WHEN i.due_date_manual THEN i.due_date END, public._inv_job_done(p_invoice));
    IF v_fin_date IS NOT NULL AND v_fin_date <= v_today THEN
      v_due := v_due + v_fin_out;
    END IF;
    RETURN round(v_due, 2);
  END IF;
  RETURN greatest(0, round(v_total - v_paid - v_cred, 2));
END $$;

REVOKE ALL ON FUNCTION public.invoice_due_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoice_due_now(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.invoice_due_now(uuid) IS
  'Payable today. Deposit stage uses the deposit until it is paid; the balance waits for its final date or job completion. Does not change the invoice.';

CREATE OR REPLACE FUNCTION public.notify_document_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token uuid; v_email text; v_name text; v_company text; v_doc_number text;
  v_total numeric; v_due_now numeric; v_items_html text; v_portal_link text; v_subject text; v_html text;
  v_quote_number text; v_quote_token uuid; v_req_id bigint; v_trigger text;
  v_is_invoice boolean := (TG_TABLE_NAME = 'invoices'); v_acc text;
  v_app_url text := 'https://field-link-sync.lovable.app';
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
BEGIN
  -- inv1b: the invoice builder finalises a NEW invoice as sent and notifies the client itself (as before), so no 2nd email.
  IF v_is_invoice AND COALESCE(current_setting('app.invoice_skip_email', true), '') = 'on' THEN RETURN NEW; END IF;
  SELECT name INTO v_company FROM public.companies WHERE companies.id = NEW.company_id;
  v_company := COALESCE(v_company, '0800-BE-COOL');

  IF TG_TABLE_NAME = 'quotes' THEN
    v_doc_number := COALESCE(NEW.quote_number, 'Quote');
    v_total := COALESCE(NEW.total, 0);
    SELECT COALESCE(NULLIF(trim(c.first_name || ' ' || COALESCE(c.last_name, '')), ''), c.name), c.email
      INTO v_name, v_email FROM public.customers c WHERE c.id = NEW.customer_id;
    IF v_email IS NULL OR v_email = '' THEN
      SELECT l.email, l.customer_name INTO v_email, v_name FROM public.leads l WHERE l.id = NEW.lead_id;
    END IF;
    SELECT string_agg(
      '<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      replace(replace(COALESCE(qi.description, 'Item'), '<', '&lt;'), '>', '&gt;') ||
      '</td><td align="center" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      COALESCE(qi.quantity::text, '1') ||
      '</td><td align="right" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      public.fmt_rand_sql(COALESCE(qi.unit_price, 0) * COALESCE(qi.quantity, 1)) || '</td></tr>', '')
      INTO v_items_html FROM public.quote_items qi WHERE qi.quote_id = NEW.id;
    IF NEW.public_token IS NOT NULL THEN v_portal_link := v_app_url || '/quote/' || NEW.public_token; END IF;
    v_subject := 'Your quote from ' || v_company;
  ELSIF v_is_invoice THEN
    v_doc_number := COALESCE(NEW.invoice_number, 'Invoice');
    v_total := COALESCE(NEW.grand_total, 0);
    v_name := NEW.customer_name;
    v_email := NEW.customer_email;
    IF v_email IS NULL OR v_email = '' THEN
      SELECT c.email INTO v_email FROM public.customers c WHERE c.id = NEW.customer_id;
    END IF;
    IF NEW.quote_id IS NOT NULL THEN
      SELECT quote_number, public_token INTO v_quote_number, v_quote_token FROM public.quotes WHERE id = NEW.quote_id;
      IF v_quote_token IS NOT NULL THEN v_portal_link := v_app_url || '/quote/' || v_quote_token; END IF;
    END IF;
    SELECT string_agg(
      '<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      replace(replace(COALESCE(ii.description, 'Item'), '<', '&lt;'), '>', '&gt;') ||
      '</td><td align="center" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      COALESCE(ii.quantity::text, '1') ||
      '</td><td align="right" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      public.fmt_rand_sql(COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)) || '</td></tr>', '')
      INTO v_items_html FROM public.invoice_items ii WHERE ii.invoice_id = NEW.id;
    v_subject := 'Invoice ' || v_doc_number || ' from ' || v_company || ' — ' || CASE WHEN COALESCE((to_jsonb(NEW)->>'deposit_amount')::numeric,0) > 0 AND (to_jsonb(NEW)->>'deposit_amount')::numeric < v_total THEN 'deposit ' || public.fmt_rand_sql((to_jsonb(NEW)->>'deposit_amount')::numeric) || ' due' ELSE public.fmt_rand_sql(v_total) || ' due' END;
    v_trigger := COALESCE(NULLIF(current_setting('app.invoice_send_trigger', true), ''), 'status_sent');
  ELSE
    RETURN NEW;
  END IF;

  IF v_email IS NULL OR trim(v_email) = '' THEN
    IF v_is_invoice THEN
      INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
      VALUES (gen_random_uuid()::text, 'invoice_email_skipped_no_email', '', v_quote_number,
        jsonb_build_object('invoice_id', NEW.id, 'invoice_number', NEW.invoice_number, 'trigger', v_trigger));
    END IF;
    RETURN NEW;
  END IF;

  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN
    IF v_is_invoice THEN
      INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
      VALUES (gen_random_uuid()::text, 'invoice_email_skipped_not_configured', v_email, v_quote_number,
        jsonb_build_object('invoice_id', NEW.id, 'invoice_number', NEW.invoice_number, 'trigger', v_trigger));
    END IF;
    RETURN NEW;
  END IF;

  v_due_now := CASE WHEN v_is_invoice THEN public.invoice_due_now(NEW.id) ELSE v_total END;

  v_html := '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    || '<body style="margin:0;padding:0;background-color:#eef3f9;font-family:Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">'
    || '<tr><td style="background-color:#0B4FA8;background-image:linear-gradient(90deg,#0B4FA8,#1AA7EC);padding:24px 32px;text-align:center;">' || COALESCE((SELECT '<div data-logo style="display:inline-block;background:#ffffff;border-radius:10px;padding:8px 14px;margin:0 0 10px;"><img src="' || replace(cp.logo_url,'"','%22') || '" alt="' || v_company || '" height="44" style="display:block;height:44px;max-width:200px;border:0;"></div>' FROM public.company_profiles cp WHERE cp.company_id = NEW.company_id AND cp.archived_at IS NULL AND cp.logo_url ~ '^https://' ORDER BY cp.is_default DESC, cp.created_at LIMIT 1), CASE WHEN v_company ILIKE 'massair%' THEN '<img data-logo-fallback src="https://field-link-sync.lovable.app/email/logo-white.png" alt="' || v_company || '" height="48" style="display:block;margin:0 auto 10px;height:48px;max-width:220px;border:0;">' ELSE '' END) || '<h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">' || v_company || '</h1>'
    || '<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">' || (CASE WHEN v_is_invoice THEN 'Invoice ' ELSE '' END) || v_doc_number || '</p></td></tr>'
    || '<tr><td style="background-color:#F7941D;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    || '<tr><td style="padding:28px 32px;">'
    || '<p style="margin:0 0 16px;font-size:15px;color:#111827;">Dear <strong>' || replace(replace(COALESCE(v_name, 'Valued Customer'), '<', '&lt;'), '>', '&gt;') || '</strong>,</p>'
    || CASE WHEN v_is_invoice THEN
         '<p style="margin:0 0 20px;font-size:14px;color:#374151;">Thank you for accepting' || COALESCE(' quote ' || v_quote_number, ' our quote') || '. Please find invoice <strong>' || v_doc_number || '</strong> for <strong>' || public.fmt_rand_sql(v_total) || '</strong> below.</p>'
       ELSE '' END
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">'
    || '<tr><th align="left" style="padding:8px 12px;border-bottom:2px solid #0B4FA8;font-size:12px;color:#6b7280;text-transform:uppercase;">Item</th>'
    || '<th align="center" style="padding:8px 12px;border-bottom:2px solid #0B4FA8;font-size:12px;color:#6b7280;text-transform:uppercase;">Qty</th>'
    || '<th align="right" style="padding:8px 12px;border-bottom:2px solid #0B4FA8;font-size:12px;color:#6b7280;text-transform:uppercase;">Amount</th></tr>'
    || COALESCE(v_items_html, '<tr><td colspan="3" style="padding:8px 12px;font-size:14px;color:#6b7280;">See attached details</td></tr>')
    || '</table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px;">'
    || '<tr><td style="padding:16px 20px;"><p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;">' || (CASE WHEN v_is_invoice AND v_due_now + 0.01 < v_total THEN 'Amount due now (incl. VAT)' WHEN v_is_invoice THEN 'Amount due (incl. VAT)' ELSE 'Total (incl. VAT)' END) || '</p>'
    || '<p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#0B4FA8;">' || public.fmt_rand_sql(v_due_now) || '</p>'
    || CASE WHEN v_is_invoice AND v_due_now + 0.01 < v_total THEN
         '<p style="margin:6px 0 0;font-size:13px;color:#374151;">Invoice total ' || public.fmt_rand_sql(v_total) || '. ' || public.fmt_rand_sql(greatest(v_total - v_due_now, 0)) || ' is due later, on completion.</p>'
       ELSE '' END
    || '</td></tr></table>'
    || CASE WHEN v_is_invoice THEN
         '<p style="margin:0 0 20px;font-size:13px;color:#6b7280;">Please use ' || v_doc_number || ' as your EFT reference.</p>'
       ELSE '' END
    || CASE WHEN v_portal_link IS NOT NULL THEN
         '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="background-color:#F7941D;border-radius:8px;">'
         || '<a href="' || v_portal_link || '" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#0B4FA8;text-decoration:none;">'
         || (CASE WHEN v_is_invoice THEN 'View &amp; Pay Your Invoice' ELSE 'View &amp; Accept Your Quote' END) || '</a></td></tr></table>'
         || '<p style="margin:0 0 8px;font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: <a href="' || v_portal_link || '" style="color:#0B4FA8;">' || v_portal_link || '</a></p>'
       ELSE '' END
    || '<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">You are receiving this email because ' || v_company || ' prepared this document for you. If you did not expect it, please ignore it or contact us.</p>'
    || '</td></tr></table></td></tr></table></body></html>';

  SELECT net.http_post(
    url := v_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_email, 'subject', v_subject, 'html', v_html,
      'signature_mode', 'person',
      'sender_user_id', COALESCE(to_jsonb(NEW)->>'sales_engineer_id', to_jsonb(NEW)->>'agent_id', to_jsonb(NEW)->>'created_by', auth.uid()::text))
  ) INTO v_req_id;

  IF v_is_invoice THEN
    INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
    VALUES (COALESCE('net:' || v_req_id::text, gen_random_uuid()::text), 'invoice_email_queued', v_email, v_quote_number,
      jsonb_build_object('invoice_id', NEW.id, 'invoice_number', NEW.invoice_number, 'net_request_id', v_req_id, 'trigger', v_trigger));
    -- acc1: every client invoice email also goes to the company's accounts mailbox (own company, no fallback).
    SELECT NULLIF(btrim(accounts_email), '') INTO v_acc FROM public.companies WHERE companies.id = NEW.company_id;
    IF v_acc IS NOT NULL AND lower(v_acc) IS DISTINCT FROM lower(btrim(v_email)) THEN
      SELECT net.http_post(url := v_fn_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
        body := jsonb_build_object('to', v_acc, 'subject', '[Copy] ' || v_subject, 'html', v_html, 'signature_mode', 'person',
          'sender_user_id', COALESCE(to_jsonb(NEW)->>'sales_engineer_id', to_jsonb(NEW)->>'agent_id', to_jsonb(NEW)->>'created_by', auth.uid()::text))
      ) INTO v_req_id;
      INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
      VALUES (COALESCE('net:' || v_req_id::text, gen_random_uuid()::text), 'invoice_email_accounts_copy', v_acc, v_quote_number,
        jsonb_build_object('invoice_id', NEW.id, 'invoice_number', NEW.invoice_number, 'net_request_id', v_req_id, 'client_to', v_email));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


create or replace function public.get_customer_invoices_public(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  select customer_id into v_cid from customer_tokens where token = p_token and (expires_at is null or expires_at > now());
  if v_cid is null then return null; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select i.id, i.invoice_number, i.customer_name, i.customer_address, i.line_items, i.subtotal, i.tax_rate, i.tax_amount,
           i.grand_total, i.payment_method, i.notes, i.status, i.paid_date, i.created_at, i.issue_date, i.due_date,
           i.billed_to_vat_number, i.company_id, i.company_profile_id, i.deposit_type, i.deposit_amount, i.quote_id,
           public.invoice_amount_paid(i.id) as amount_paid,
           public.invoice_due_now(i.id) as due_now,
           i.expected_deposit_date, i.expected_final_date, i.due_date_manual,
           public._inv_job_done(i.id) as job_done,
           i.sent_at,
           coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'payment_date', p.payment_date, 'created_at', p.created_at, 'status', p.status, 'gateway', p.gateway) order by p.payment_date, p.created_at)
                       from payments p where p.invoice_id = i.id
                        and (p.status in ('paid','succeeded','completed') or (p.status is null and p.gateway = 'manual'))), '[]'::jsonb) as stamp_payments
      from invoices i
     where (i.customer_id = v_cid or i.lead_id in (select l.id from leads l where l.customer_id = v_cid))
       and coalesce(i.status,'') not in ('void','cancelled','draft')) x), '[]'::jsonb);
end $$;
grant execute on function public.get_customer_invoices_public(uuid) to anon, authenticated;
