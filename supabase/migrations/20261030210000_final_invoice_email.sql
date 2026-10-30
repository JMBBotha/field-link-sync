-- Final invoice by email (Johan 30 Oct 20:29). Re-runnable.
-- send_final_invoice_email(invoice, to, mode): mode 'preview' returns {to, subject, html} and sends nothing;
-- 'send' emails via send-transactional-email (Resend, 0800becool.co.za sender), logs email_events + stamps
-- final_sent_* via log_final_invoice_send (10-min double-send guard); 'test' sends a [TEST] copy to p_to only,
-- never stamps the invoice and never copies the accounts mailbox.
CREATE OR REPLACE FUNCTION public.send_final_invoice_email(p_invoice uuid, p_to text DEFAULT NULL, p_mode text DEFAULT 'preview')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid(); inv public.invoices%ROWTYPE;
  v_paid numeric; v_bal numeric; v_to text; v_name text; v_subject text; v_html text; v_terms text;
  v_tok uuid; v_link text; v_token uuid; v_req bigint; v_log jsonb; v_snap jsonb; v_legal text; v_acc text;
  v_app_url text := 'https://field-link-sync.lovable.app';
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
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

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'html', v_html, 'balance', v_bal, 'final_sent_at', inv.final_sent_at, 'final_sent_channel', inv.final_sent_channel);
  END IF;

  IF p_mode = 'send' AND inv.final_sent_at IS NOT NULL AND inv.final_sent_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'final_sent_at', inv.final_sent_at, 'to', v_to);
  END IF;

  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not set up'; END IF;
  SELECT net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', v_html, 'signature_mode', 'person', 'sender_user_id', v_uid::text, 'company_id', inv.company_id)
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
      body := jsonb_build_object('to', v_acc, 'subject', '[Copy] ' || v_subject, 'html', v_html, 'signature_mode', 'person', 'sender_user_id', v_uid::text, 'company_id', inv.company_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'final_sent_at', coalesce(v_log->>'final_sent_at', now()::text), 'channel', 'email');
END $function$;
REVOKE ALL ON FUNCTION public.send_final_invoice_email(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_final_invoice_email(uuid, text, text) TO authenticated;
