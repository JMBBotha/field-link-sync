-- Deposit invoice auto-email on accept + send logging.
-- Behaviour:
--  * create_deposit_invoice_for_quote: only in the INSERT branch (never when an invoice exists),
--    after invoice_items: if customer email present -> status 'sent' (+issue_date), which fires
--    trg_invoices_sent_email exactly once (trigger WHEN old.status <> 'sent'). Else notify sales engineer/admins.
--  * Idempotent: per-quote advisory lock + early return on existing invoice => second accept never re-sends.
--  * notify_document_sent: invoices email shows number, SA amount, pay link (/quote/<public_token>),
--    'View & Pay Your Invoice'; every invoice attempt logged in email_events (SECURITY DEFINER bypasses RLS).

CREATE OR REPLACE FUNCTION public.fmt_rand_sql(v numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT 'R ' || translate(to_char(COALESCE(v,0), 'FM999,999,999,990.00'), ',.', ' ,');
$$;

CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  q public.quotes%ROWTYPE;
  cust record;
  v_existing uuid;
  v_pct numeric; v_frac numeric; v_number text;
  v_subtotal numeric; v_vat numeric; v_total numeric; v_rate numeric;
  v_agent uuid; v_id uuid;
  v_email text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('deposit_invoice:' || p_quote_id::text, 0));

  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.invoices WHERE quote_id = q.id ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(default_deposit_percentage, 70) INTO v_pct
  FROM public.company_settings ORDER BY updated_at DESC NULLS LAST, id LIMIT 1;
  v_pct := COALESCE(v_pct, 70);
  IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 70; END IF;
  v_frac := v_pct / 100.0;

  v_subtotal := ROUND(COALESCE(q.subtotal, 0) * v_frac, 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0) * v_frac, 2);
  v_total := ROUND(COALESCE(q.total, 0) * v_frac, 2);
  v_rate := COALESCE(q.vat_rate, 0.15);
  IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;

  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN RETURN NULL; END IF;

  v_number := public.generate_invoice_number();

  INSERT INTO public.invoices (
    quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total,
    due_date, status, line_items, company_id, notes
  ) VALUES (
    q.id, q.lead_id, v_agent, q.customer_id,
    COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_subtotal, v_rate, v_vat, v_total,
    CURRENT_DATE + 30, 'draft',
    jsonb_build_array(jsonb_build_object(
      'description', 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
      'quantity', 1, 'rate', v_subtotal, 'amount', v_subtotal)),
    q.company_id,
    'DEPOSIT — ' || ROUND(v_pct)::text || '% of quote ' || COALESCE(q.quote_number, '') || '. Balance invoiced on completion.'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id, 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
    1, v_subtotal, v_subtotal);

  -- Auto-send (insert branch only)
  v_email := NULLIF(trim(COALESCE(cust.email, '')), '');
  IF v_email IS NOT NULL THEN
    PERFORM set_config('app.invoice_send_trigger', 'accept_auto', true);
    UPDATE public.invoices
       SET status = 'sent', issue_date = COALESCE(issue_date, CURRENT_DATE)
     WHERE id = v_id;
    PERFORM set_config('app.invoice_send_trigger', '', true);
  ELSE
    INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
    VALUES (gen_random_uuid()::text, 'invoice_email_skipped_no_email', '', q.quote_number,
      jsonb_build_object('invoice_id', v_id, 'invoice_number', v_number, 'trigger', 'accept_auto'));

    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    SELECT u, 'deposit_invoice_not_emailed', 'Deposit invoice not emailed — no client email',
      'Invoice ' || v_number || ' for quote ' || COALESCE(q.quote_number, '') || ' was not emailed because the client has no email address. Share the pay link by WhatsApp or copy.',
      v_id, jsonb_build_object('invoice_id', v_id, 'quote_id', q.id)
    FROM (
      SELECT q.sales_engineer_id AS u WHERE q.sales_engineer_id IS NOT NULL
      UNION
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE q.sales_engineer_id IS NULL AND ur.role = 'admin' AND p.company_id = q.company_id
    ) t;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_document_sent()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_token uuid; v_email text; v_name text; v_company text; v_doc_number text;
  v_total numeric; v_items_html text; v_portal_link text; v_subject text; v_html text;
  v_quote_number text; v_quote_token uuid; v_req_id bigint; v_trigger text;
  v_is_invoice boolean := (TG_TABLE_NAME = 'invoices');
  v_app_url text := 'https://field-link-sync.lovable.app';
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
BEGIN
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
    v_subject := 'Invoice ' || v_doc_number || ' from ' || v_company || ' — ' || public.fmt_rand_sql(v_total) || ' due';
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

  v_html := '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    || '<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">'
    || '<tr><td style="background-color:#1B3A5C;padding:24px 32px;text-align:center;"><h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">' || v_company || '</h1>'
    || '<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">' || (CASE WHEN v_is_invoice THEN 'Invoice ' ELSE '' END) || v_doc_number || '</p></td></tr>'
    || '<tr><td style="background-color:#F59E0B;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    || '<tr><td style="padding:28px 32px;">'
    || '<p style="margin:0 0 16px;font-size:15px;color:#111827;">Dear <strong>' || replace(replace(COALESCE(v_name, 'Valued Customer'), '<', '&lt;'), '>', '&gt;') || '</strong>,</p>'
    || CASE WHEN v_is_invoice THEN
         '<p style="margin:0 0 20px;font-size:14px;color:#374151;">Thank you for accepting' || COALESCE(' quote ' || v_quote_number, ' our quote') || '. Please find invoice <strong>' || v_doc_number || '</strong> for <strong>' || public.fmt_rand_sql(v_total) || '</strong> below.</p>'
       ELSE '' END
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">'
    || '<tr><th align="left" style="padding:8px 12px;border-bottom:2px solid #1B3A5C;font-size:12px;color:#6b7280;text-transform:uppercase;">Item</th>'
    || '<th align="center" style="padding:8px 12px;border-bottom:2px solid #1B3A5C;font-size:12px;color:#6b7280;text-transform:uppercase;">Qty</th>'
    || '<th align="right" style="padding:8px 12px;border-bottom:2px solid #1B3A5C;font-size:12px;color:#6b7280;text-transform:uppercase;">Amount</th></tr>'
    || COALESCE(v_items_html, '<tr><td colspan="3" style="padding:8px 12px;font-size:14px;color:#6b7280;">See attached details</td></tr>')
    || '</table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px;">'
    || '<tr><td style="padding:16px 20px;"><p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;">' || (CASE WHEN v_is_invoice THEN 'Amount due (incl. VAT)' ELSE 'Total (incl. VAT)' END) || '</p>'
    || '<p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#1B3A5C;">' || public.fmt_rand_sql(v_total) || '</p></td></tr></table>'
    || CASE WHEN v_portal_link IS NOT NULL THEN
         '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="background-color:#F59E0B;border-radius:8px;">'
         || '<a href="' || v_portal_link || '" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#1B3A5C;text-decoration:none;">'
         || (CASE WHEN v_is_invoice THEN 'View &amp; Pay Your Invoice' ELSE 'View &amp; Accept Your Quote' END) || '</a></td></tr></table>'
         || '<p style="margin:0 0 8px;font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: <a href="' || v_portal_link || '" style="color:#1B3A5C;">' || v_portal_link || '</a></p>'
       ELSE '' END
    || '<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">You are receiving this email because ' || v_company || ' prepared this document for you. If you did not expect it, please ignore it or contact us.</p>'
    || '</td></tr></table></td></tr></table></body></html>';

  SELECT net.http_post(
    url := v_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_email, 'subject', v_subject, 'html', v_html)
  ) INTO v_req_id;

  IF v_is_invoice THEN
    INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
    VALUES (COALESCE('net:' || v_req_id::text, gen_random_uuid()::text), 'invoice_email_queued', v_email, v_quote_number,
      jsonb_build_object('invoice_id', NEW.id, 'invoice_number', NEW.invoice_number, 'net_request_id', v_req_id, 'trigger', v_trigger));
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fmt_rand_sql(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fmt_rand_sql(numeric) TO authenticated, service_role;