-- Friendly payment reminder straight from an invoice (Johan 2 Nov 17:47 "Yes friendly reminder").
-- Own subject + wording (not the final-invoice email). Preview first; send only with the previewed html.
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
