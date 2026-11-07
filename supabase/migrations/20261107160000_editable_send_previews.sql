-- Editable send previews (Johan 7 Nov 2026).
-- Final invoice, booking confirmation and draft-invoice email use the subject and message
-- the office typed in the preview. Omitting them keeps the previous template.
-- Reminders are recreated unchanged so they still call send_final_invoice_email with 3 args.

DROP FUNCTION IF EXISTS public.send_payment_reminder(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.send_invoice_reminder(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.send_final_invoice_email(uuid, text, text);

CREATE OR REPLACE FUNCTION public.send_final_invoice_email(p_invoice uuid, p_to text DEFAULT NULL, p_mode text DEFAULT 'preview', p_subject text DEFAULT NULL, p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid(); inv public.invoices%ROWTYPE;
  v_paid numeric; v_bal numeric; v_to text; v_name text; v_subject text; v_html text; v_terms text; v_message text; v_message_html text;
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
  IF p_mode IN ('send','test') AND p_subject IS NOT NULL AND nullif(btrim(p_subject), '') IS NULL THEN
    RAISE EXCEPTION 'Write a subject before sending';
  END IF;
  IF p_mode IN ('send','test') AND p_message IS NOT NULL AND nullif(btrim(p_message), '') IS NULL THEN
    RAISE EXCEPTION 'Write a message before sending';
  END IF;
  IF length(coalesce(p_message,'')) > 4000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
  IF nullif(btrim(p_subject), '') IS NOT NULL THEN
    v_subject := left(regexp_replace(btrim(p_subject), '[[:cntrl:]]', ' ', 'g'), 180);
  END IF;
  IF p_mode = 'test' AND v_subject NOT LIKE '[TEST] %' THEN v_subject := '[TEST] ' || v_subject; END IF;
  v_message := coalesce(nullif(btrim(p_message), ''), 'Thank you, the work is done. Here is your final invoice for the balance. Use the button below to view and pay it.');
  v_message_html := replace(replace(replace(v_message, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_message_html := replace(v_message_html, E'\n', '<br/>');

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
    || '<p style="margin:0 0 18px;font-size:14px;color:#374151;">' || v_message_html || '</p>'
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
      'link', v_link, 'companyLines', v_lines, 'termsHtml', nullif(v_terms,''), 'message', v_message));
  v_layout := jsonb_strip_nulls(v_layout);

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'message', v_message, 'html', v_html, 'layout', v_layout, 'balance', v_bal, 'final_sent_at', inv.final_sent_at, 'final_sent_channel', inv.final_sent_channel);
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


REVOKE ALL ON FUNCTION public.send_final_invoice_email(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_final_invoice_email(uuid, text, text, text, text) TO authenticated;


create or replace function public.send_invoice_reminder(p_invoice uuid, p_mode text default 'preview', p_to text default null, p_html text default null, p_subject text default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); inv public.invoices; v_admin boolean; v_pre jsonb; v_layout jsonb;
  v_subject text; v_msg text; v_to text; v_token uuid; v_req bigint; v_tok uuid; v_due date; v_amt numeric; v_company text; v_late boolean;
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_mode not in ('preview','send') then raise exception 'Unknown mode'; end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.company_id is distinct from public.get_user_company_id(v_uid) then raise exception 'Invoice not found'; end if;
  v_admin := coalesce(public.is_company_owner(v_uid, inv.company_id), false) or public.has_role(v_uid, 'admin') or public._pf_owner(inv.company_id)
             or exists (select 1 from company_members where user_id = v_uid and company_id = inv.company_id and role = 'admin');
  if not v_admin then raise exception 'Only an admin can send payment reminders' using errcode = '42501'; end if;
  v_amt := public._pf_amount_due(p_invoice);
  if lower(coalesce(inv.status,'')) in ('paid','void','cancelled') or v_amt <= 0 then raise exception 'This invoice is paid or void, so nothing was sent.'; end if;
  v_due := public._inv_due_eff(p_invoice);
  if v_due is null then raise exception 'Not due yet: the balance is due on completion of the job.'; end if;
  v_late := v_due < (now() at time zone 'Africa/Johannesburg')::date;
  select name into v_company from public.companies where id = inv.company_id;
  v_subject := coalesce(nullif(btrim(p_subject),''), case when v_late then format('Friendly reminder: invoice %s is overdue', inv.invoice_number)
                 else format('Friendly reminder: invoice %s', inv.invoice_number) end);
  v_msg := coalesce(nullif(btrim(p_message),''), format(case when v_late
    then E'Hi %1$s,\n\nJust a friendly reminder that R%3$s is still outstanding on invoice %2$s, which was due on %4$s. If you have already paid, thank you, and please send us the proof of payment so we can update our records.\n\nYou can pay by EFT using the banking details below, or use the button to view and pay the invoice online.\n\nKind regards,\n%5$s'
    else E'Hi %1$s,\n\nJust a friendly reminder that R%3$s is outstanding on invoice %2$s, due on %4$s. If you have already paid, thank you, and please send us the proof of payment so we can update our records.\n\nYou can pay by EFT using the banking details below, or use the button to view and pay the invoice online.\n\nKind regards,\n%5$s' end,
    coalesce(nullif(btrim(split_part(coalesce(inv.customer_name,''),' ',1)),''),'there'), coalesce(inv.invoice_number,''), to_char(v_amt,'FM999G999G990D00'), to_char(v_due,'FMDD FMMonth YYYY'), coalesce(v_company,'the team')));
  v_pre := public.send_final_invoice_email(p_invoice, nullif(btrim(p_to),''), 'preview');
  v_to := v_pre->>'to';
  v_layout := (v_pre->'layout') || jsonb_build_object('template', 'payment_reminder', 'title', v_subject, 'kicker', 'Payment reminder')
              || jsonb_build_object('data', (v_pre->'layout'->'data') || jsonb_build_object('message', v_msg, 'dueDate', to_char(v_due, 'FMDD FMMonth YYYY') || case when v_late then ' (overdue)' else '' end));
  if p_mode = 'preview' then
    return jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'message', v_msg, 'layout', v_layout, 'overdue', v_late);
  end if;
  if p_html is null or length(p_html) < 200 or p_html !~* 'payment reminder' then raise exception 'Open the preview first, then press Send'; end if;
  if inv.customer_id is not null then
    select token into v_tok from customer_tokens where customer_id = inv.customer_id and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
    if v_tok is null then insert into customer_tokens (customer_id) values (inv.customer_id) returning token into v_tok; end if;
    p_html := replace(p_html, 'https://field-link-sync.lovable.app/customer/…/invoice/', 'https://field-link-sync.lovable.app/customer/' || v_tok::text || '/invoice/');
  end if;
  select email_webhook_token into v_token from public.app_webhook_config where id = 1;
  if v_token is null then raise exception 'Email is not set up'; end if;
  select net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', p_html, 'signature_mode', 'reminder', 'sender_user_id', v_uid::text, 'company_id', inv.company_id)) into v_req;
  insert into public.email_events (email_id, event_type, recipient_email, event_data)
  values ('net:' || v_req::text, 'payment_reminder_queued', v_to, jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'source', 'manual', 'net_request_id', v_req, 'by', v_uid));
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', inv.company_id, inv.id, 'invoices', v_uid, null, jsonb_build_object('event', 'payment_reminder_sent', 'source', 'manual', 'to', v_to, 'subject', v_subject, 'net_request_id', v_req));
  return jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'sent_at', now());
end $$;
revoke execute on function public.send_invoice_reminder(uuid, text, text, text, text, text) from anon;

create or replace function public.send_payment_reminder(p_followup uuid, p_mode text default 'preview', p_html text default null, p_subject text default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); f public.payment_followups; inv public.invoices; v_admin boolean; v_pre jsonb; v_layout jsonb;
  v_subject text; v_msg text; v_to text; v_token uuid; v_req bigint; v_tok uuid;
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_mode not in ('preview','send') then raise exception 'Unknown mode'; end if;
  select * into f from public.payment_followups where id = p_followup for update;
  if f.id is null or f.company_id is distinct from public.get_user_company_id(v_uid) then raise exception 'Reminder not found'; end if;
  v_admin := coalesce(public.is_company_owner(v_uid, f.company_id), false) or public.has_role(v_uid, 'admin') or public._pf_owner(f.company_id)
             or exists (select 1 from company_members where user_id = v_uid and company_id = f.company_id and role = 'admin');
  if not v_admin then raise exception 'Only an admin can send payment reminders' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = f.invoice_id;
  if lower(coalesce(inv.status,'')) in ('paid','void','cancelled') or public._pf_amount_due(f.invoice_id) <= 0 then
    update public.payment_followups set status = 'cancelled', decision_note = 'invoice paid or void' where id = f.id and status in ('pending','approved');
    raise exception 'This invoice is paid or void, so nothing was sent.';
  end if;
  if f.status not in ('pending','approved') then raise exception 'This reminder is already %', f.status; end if;
  if public._inv_due_eff(f.invoice_id) is null then raise exception 'Not due yet: the balance is due on completion of the job. Decline this old reminder.'; end if;
  v_subject := coalesce(nullif(btrim(p_subject),''), f.subject, 'Payment reminder: invoice ' || coalesce(f.invoice_number,''));
  v_msg := coalesce(nullif(btrim(p_message),''), f.approved_message, f.proposed_message, '');
  v_pre := public.send_final_invoice_email(f.invoice_id, null, 'preview');
  v_to := v_pre->>'to';
  v_layout := (v_pre->'layout') || jsonb_build_object('template', 'payment_reminder', 'title', v_subject, 'kicker', 'Payment reminder')
              || jsonb_build_object('data', (v_pre->'layout'->'data') || jsonb_build_object('message', v_msg, 'dueDate', to_char(coalesce(f.due_date, public._inv_due_eff(f.invoice_id)), 'FMDD FMMonth YYYY')));
  if p_mode = 'preview' then
    return jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'message', v_msg, 'layout', v_layout, 'step', f.step, 'status', f.status);
  end if;
  if p_html is null or length(p_html) < 200 or p_html !~* 'payment reminder' then raise exception 'Open the preview first, then press Send'; end if;
  -- Real link for the client (preview shows a placeholder).
  if inv.customer_id is not null then
    select token into v_tok from customer_tokens where customer_id = inv.customer_id and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
    if v_tok is null then insert into customer_tokens (customer_id) values (inv.customer_id) returning token into v_tok; end if;
    p_html := replace(p_html, 'https://field-link-sync.lovable.app/customer/…/invoice/', 'https://field-link-sync.lovable.app/customer/' || v_tok::text || '/invoice/');
  end if;
  select email_webhook_token into v_token from public.app_webhook_config where id = 1;
  if v_token is null then raise exception 'Email is not set up'; end if;
  select net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', p_html, 'signature_mode', 'reminder', 'sender_user_id', v_uid::text, 'company_id', f.company_id)) into v_req;
  update public.payment_followups set status = 'sent', sent_at = now(), sent_by = v_uid, channel = 'email', subject = v_subject,
    approved_message = v_msg, decided_by = coalesce(decided_by, v_uid), decided_at = coalesce(decided_at, now()) where id = f.id;
  insert into public.email_events (email_id, event_type, recipient_email, event_data)
  values ('net:' || v_req::text, 'payment_reminder_queued', v_to, jsonb_build_object('invoice_id', f.invoice_id, 'invoice_number', f.invoice_number, 'followup_id', f.id, 'step', f.step, 'net_request_id', v_req, 'by', v_uid));
  insert into audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  values ('update', f.company_id, f.invoice_id, 'invoices', v_uid, null, jsonb_build_object('event', 'payment_reminder_sent', 'followup_id', f.id, 'step', f.step, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req));
  return jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'sent_at', now());
end $$;

revoke execute on function public.send_payment_reminder(uuid, text, text, text, text) from anon;


CREATE OR REPLACE FUNCTION public._plain_email_html(p_text text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $html$
DECLARE v text; para text; built text := '';
BEGIN
  v := replace(replace(replace(replace(coalesce(p_text,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
  FOREACH para IN ARRAY regexp_split_to_array(v, E'\n{2,}') LOOP
    IF btrim(replace(para, E'\n', '')) = '' THEN CONTINUE; END IF;
    built := built || '<p>' || replace(para, E'\n', '<br>') || '</p>';
  END LOOP;
  RETURN '<html><body><div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#1f2937">' || built || '</div></body></html>';
END
$html$;
REVOKE ALL ON FUNCTION public._plain_email_html(text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.send_booking_confirmation(uuid, text, text);

CREATE OR REPLACE FUNCTION public.send_booking_confirmation(p_job_id uuid, p_mode text DEFAULT 'preview', p_to text DEFAULT NULL, p_subject text DEFAULT NULL, p_body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); j record; v_kind text; v_msg jsonb; v_to text; v_subject text; v_html text; v_token uuid; v_req bigint;
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
  IF p_subject IS NOT NULL AND nullif(btrim(p_subject), '') IS NULL THEN RAISE EXCEPTION 'Write a subject before sending'; END IF;
  IF p_body IS NOT NULL AND nullif(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Write a message before sending'; END IF;
  IF length(coalesce(p_body,'')) > 4000 THEN RAISE EXCEPTION 'Message is too long'; END IF;
  v_subject := coalesce(nullif(left(regexp_replace(btrim(coalesce(p_subject,'')), '[[:cntrl:]]', ' ', 'g'), 180), ''), v_msg->>'subject');
  v_html := CASE WHEN nullif(btrim(p_body), '') IS NOT NULL THEN public._plain_email_html(p_body) ELSE v_msg->>'html' END;
  IF v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'No valid email address'; END IF;
  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not set up'; END IF;
  SELECT net.http_post(url := v_fn_url,
    headers := jsonb_build_object('Content-Type','application/json','x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', v_html, 'signature_mode', 'company', 'sender_user_id', v_uid::text, 'company_id', j.company_id)) INTO v_req;
  INSERT INTO public.email_events (email_id, event_type, recipient_email, event_data)
  VALUES ('net:' || v_req::text, 'booking_confirmation_queued', v_to, jsonb_build_object('job_id', j.id, 'call_out', v_kind = 'service', 'net_request_id', v_req, 'by', v_uid));
  RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req, 'sent_at', now());
END $$;

REVOKE ALL ON FUNCTION public.send_booking_confirmation(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_booking_confirmation(uuid, text, text, text, text) TO authenticated;


-- Draft invoice "Preview & email": send the preview html and subject the office edited,
-- and skip notify_document_sent so the template is not emailed as well.
CREATE OR REPLACE FUNCTION public.send_reviewed_invoice_email(p_invoice uuid, p_subject text, p_html text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  inv public.invoices%ROWTYPE;
  v_to text; v_subject text; v_token uuid; v_req bigint;
  v_owner boolean; v_admin boolean; v_rep boolean; v_office boolean;
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice;
  IF inv.id IS NULL OR inv.company_id IS DISTINCT FROM public.get_user_company_id(v_uid) THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  v_owner := coalesce(public.is_company_owner(v_uid, inv.company_id), false);
  v_admin := public.has_role(v_uid, 'admin') OR EXISTS (SELECT 1 FROM public.company_members WHERE user_id = v_uid AND company_id = inv.company_id AND role = 'admin');
  v_rep := public.is_sales_rep(v_uid);
  v_office := public.has_role(v_uid, 'dispatcher') AND NOT v_rep;
  IF NOT (v_owner OR v_admin OR v_office OR (v_rep AND coalesce(public.rep_can_see_invoice(v_uid, p_invoice), false))) THEN
    RAISE EXCEPTION 'You are not allowed to send this invoice';
  END IF;
  IF lower(coalesce(inv.status, '')) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice can be emailed from this preview';
  END IF;
  IF NOT public.is_company_writable(inv.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_archived');
  END IF;
  IF nullif(btrim(p_subject), '') IS NULL THEN RAISE EXCEPTION 'Write a subject before sending'; END IF;
  IF p_html IS NULL OR length(p_html) < 80 OR length(p_html) > 200000 THEN RAISE EXCEPTION 'Open the preview first, then press Send'; END IF;
  IF p_html ~* '<\s*script' OR p_html ~* 'javascript\s*:' THEN RAISE EXCEPTION 'That email cannot be sent'; END IF;
  IF coalesce(inv.invoice_number, '') <> '' AND position(inv.invoice_number IN p_html) = 0 THEN
    RAISE EXCEPTION 'Keep the invoice number in the email';
  END IF;
  v_subject := left(regexp_replace(btrim(p_subject), '[[:cntrl:]]', ' ', 'g'), 180);
  v_to := lower(btrim(coalesce(nullif(btrim(inv.customer_email), ''), (SELECT email FROM public.customers WHERE id = inv.customer_id), '')));
  IF v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'No valid email address for this client'; END IF;
  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not set up'; END IF;
  PERFORM set_config('app.invoice_skip_email', 'on', true);
  UPDATE public.invoices SET status = 'sent', updated_at = now() WHERE id = inv.id AND lower(coalesce(status, '')) = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice was not a draft'; END IF;
  SELECT net.http_post(
    url := v_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_to, 'subject', v_subject, 'html', p_html, 'signature_mode', 'person', 'sender_user_id', v_uid::text, 'company_id', inv.company_id)
  ) INTO v_req;
  INSERT INTO public.email_events (email_id, event_type, recipient_email, event_data)
  VALUES ('net:' || v_req::text, 'invoice_email_queued', v_to,
    jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'net_request_id', v_req, 'trigger', 'preview_edit', 'by', v_uid, 'subject', v_subject));
  RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req);
END
$fn$;
REVOKE ALL ON FUNCTION public.send_reviewed_invoice_email(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_reviewed_invoice_email(uuid, text, text) TO authenticated;
