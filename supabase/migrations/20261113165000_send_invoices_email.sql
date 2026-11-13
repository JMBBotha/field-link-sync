-- Email several invoices to one client in a single message.
-- Preview returns the email and sends nothing. Send posts ONE request to
-- send-transactional-email (combined PDF in file_attachments), then logs and
-- marks each included invoice. Invoice totals and numbers are not written.
-- Void invoices and drafts with an R0 total or an R0 line are left out.
-- Apply with the normal migration path. This change does not run it.

CREATE OR REPLACE FUNCTION public.send_invoices_email(
  p_ids uuid[],
  p_to text DEFAULT NULL,
  p_mode text DEFAULT 'preview',
  p_attachment jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_seen uuid[] := '{}';
  v_included uuid[] := '{}';
  v_excluded jsonb := '[]'::jsonb;
  v_customer uuid;
  v_company uuid;
  v_company_name text;
  v_mismatch boolean := false;
  inv public.invoices%ROWTYPE;
  v_block text;
  v_owner boolean;
  v_admin boolean;
  v_rep boolean;
  v_office boolean;
  v_to text;
  v_subject text;
  v_html text;
  v_rows text := '';
  v_numbers text := '';
  v_list jsonb := '[]'::jsonb;
  v_due numeric;
  v_link text;
  v_tok uuid;
  v_num text;
  v_app_url text := 'https://field-link-sync.lovable.app';
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
  v_token uuid;
  v_req bigint;
  v_from_email text;
  v_from_name text;
  v_legal text;
  v_prof_email text;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_mode NOT IN ('preview', 'send') THEN RAISE EXCEPTION 'Unknown mode'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Select at least two invoices for the same client.', 'excluded', '[]'::jsonb, 'invoices', '[]'::jsonb);
  END IF;
  IF cardinality(p_ids) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Choose 20 or fewer invoices.', 'excluded', '[]'::jsonb, 'invoices', '[]'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    IF v_id = ANY (v_seen) THEN CONTINUE; END IF;
    v_seen := v_seen || v_id;
    SELECT * INTO inv FROM public.invoices WHERE id = v_id;
    IF inv.id IS NULL OR inv.company_id IS DISTINCT FROM public.get_user_company_id(v_uid) THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;
    v_owner := coalesce(public.is_company_owner(v_uid, inv.company_id), false);
    v_admin := public.has_role(v_uid, 'admin') OR EXISTS (
      SELECT 1 FROM public.company_members WHERE user_id = v_uid AND company_id = inv.company_id AND role = 'admin');
    v_rep := public.is_sales_rep(v_uid);
    v_office := public.has_role(v_uid, 'dispatcher') AND NOT v_rep;
    IF NOT (v_owner OR v_admin OR v_office OR (v_rep AND coalesce(public.rep_can_see_invoice(v_uid, inv.id), false))) THEN
      RAISE EXCEPTION 'You are not allowed to send this invoice';
    END IF;

    IF inv.customer_id IS NOT NULL THEN
      IF v_customer IS NULL THEN v_customer := inv.customer_id;
      ELSIF v_customer IS DISTINCT FROM inv.customer_id THEN v_mismatch := true;
      END IF;
    END IF;
    IF v_company IS NULL THEN v_company := inv.company_id;
    ELSIF v_company IS DISTINCT FROM inv.company_id THEN RAISE EXCEPTION 'Invoice not found'; END IF;

    v_block := NULL;
    IF lower(coalesce(inv.status, '')) IN ('void', 'cancelled') THEN
      v_block := coalesce(inv.invoice_number, 'Invoice') || ' is ' || lower(inv.status) || ' and was left out.';
    ELSIF inv.customer_id IS NULL THEN
      v_block := coalesce(inv.invoice_number, 'Invoice') || ' is not linked to a client.';
    ELSIF lower(coalesce(inv.status, '')) = 'draft' AND (
      coalesce(inv.grand_total, 0) <= 0
      OR EXISTS (
        SELECT 1 FROM public.invoice_items ii
         WHERE ii.invoice_id = inv.id
           AND coalesce(ii.line_type, '') <> 'deposit'
           AND coalesce(ii.quantity, 1) <> 0
           AND coalesce(ii.unit_price, 0) <= 0
      )
      OR (
        NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = inv.id)
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(inv.line_items, '[]'::jsonb)) el
           WHERE coalesce(el->>'line_type', '') <> 'deposit'
             AND coalesce(CASE WHEN coalesce(el->>'quantity', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (el->>'quantity')::numeric ELSE 1 END, 1) <> 0
             AND (el ? 'unit_price' OR el ? 'rate' OR el ? 'description' OR el ? 'line_name')
             AND coalesce(CASE WHEN coalesce(el->>'unit_price', el->>'rate', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN coalesce(el->>'unit_price', el->>'rate')::numeric END, 0) <= 0
        )
      )
    ) THEN
      v_block := coalesce(inv.invoice_number, 'Invoice') || ' is a draft with R0. Enter a price before sending it.';
    END IF;

    IF v_block IS NOT NULL THEN
      v_excluded := v_excluded || jsonb_build_object('id', inv.id, 'invoice_number', inv.invoice_number, 'reason', v_block);
    ELSE
      v_included := v_included || inv.id;
    END IF;
  END LOOP;

  IF v_mismatch THEN RAISE EXCEPTION 'All selected invoices must be for the same client.'; END IF;

  IF cardinality(v_included) < 2 THEN
    v_reason := coalesce((SELECT string_agg(e->>'reason', ' ') FROM jsonb_array_elements(v_excluded) e), '') ||
      CASE WHEN v_excluded <> '[]'::jsonb THEN ' ' ELSE '' END ||
      'Select at least two invoices for the same client.';
    RETURN jsonb_build_object('ok', false, 'reason', btrim(v_reason), 'excluded', v_excluded, 'invoices', '[]'::jsonb);
  END IF;

  SELECT coalesce(nullif(btrim(name), ''), 'Field Lynk') INTO v_company_name FROM public.companies WHERE id = v_company;
  v_company_name := regexp_replace(coalesce(v_company_name, 'Field Lynk'), '\s*Ind\.?\s*CC', ' (Pty) Ltd', 'gi');
  SELECT nullif(btrim(email), ''), nullif(btrim(legal_name), '')
    INTO v_prof_email, v_legal
    FROM public.company_profiles
   WHERE company_id = v_company AND archived_at IS NULL
   ORDER BY is_default DESC, created_at
   LIMIT 1;
  v_from_name := coalesce(v_legal, v_company_name);
  v_from_name := regexp_replace(v_from_name, '\s*Ind\.?\s*CC', ' (Pty) Ltd', 'gi');
  v_from_email := lower(btrim(coalesce(v_prof_email, '')));
  IF v_from_email !~ '^[^@\s]+@0800becool\.co\.za$' THEN v_from_email := NULL; END IF;

  SELECT token INTO v_tok FROM public.customer_tokens
   WHERE customer_id = v_customer AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC LIMIT 1;
  IF v_tok IS NULL THEN
    INSERT INTO public.customer_tokens (customer_id) VALUES (v_customer) RETURNING token INTO v_tok;
  END IF;

  FOREACH v_id IN ARRAY v_included LOOP
    SELECT * INTO inv FROM public.invoices WHERE id = v_id;
    v_due := round(coalesce(public.invoice_due_now(inv.id), 0), 2);
    v_num := replace(replace(replace(coalesce(inv.invoice_number, 'Invoice'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_link := v_app_url || '/customer/' || v_tok::text || '/invoice/' || inv.id::text;
    v_numbers := v_numbers || CASE WHEN v_numbers = '' THEN '' ELSE ', ' END || coalesce(inv.invoice_number, 'Invoice');
    v_rows := v_rows || '<p style="margin:0 0 14px;"><strong>' || v_num || '</strong><br>Amount ' || public.fmt_rand_sql(coalesce(inv.grand_total, 0))
      || '<br>Amount due ' || public.fmt_rand_sql(v_due)
      || '<br><a href="' || v_link || '">Open ' || v_num || '</a></p>';
    v_list := v_list || jsonb_build_object(
      'id', inv.id, 'invoice_number', inv.invoice_number,
      'amount', coalesce(inv.grand_total, 0), 'amount_due', v_due, 'link', v_link, 'status', inv.status);
  END LOOP;

  v_subject := 'Invoices ' || v_numbers || ' from ' || v_company_name;
  v_to := lower(btrim(coalesce(nullif(btrim(p_to), ''),
    (SELECT customer_email FROM public.invoices WHERE id = v_included[1]),
    (SELECT email FROM public.customers WHERE id = v_customer))));

  v_html := '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    || '<body style="margin:0;padding:0;background:#eef3f9;font-family:Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">'
    || '<tr><td style="background:#3D9BEB;padding:22px 28px;"><h1 style="margin:0;font-size:20px;color:#ffffff;">' || replace(replace(replace(v_company_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</h1>'
    || '<p style="margin:4px 0 0;font-size:12px;color:#ffffff;">Your invoices</p></td></tr>'
    || '<tr><td style="padding:24px 28px;font-size:14px;color:#111827;line-height:1.5;">'
    || '<p style="margin:0 0 14px;">Here are ' || cardinality(v_included) || ' invoices from ' || replace(replace(replace(v_company_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '.</p>'
    || v_rows
    || '<p style="margin:8px 0 0;">Pay by EFT and use the invoice number as your reference. The invoices are attached as one PDF.</p>'
    || '</td></tr></table></td></tr></table></body></html>';

  IF v_to IS NULL OR v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    IF p_mode = 'preview' THEN
      RETURN jsonb_build_object('ok', true, 'to', coalesce(v_to, ''), 'subject', v_subject, 'html', v_html,
        'excluded', v_excluded, 'invoices', v_list, 'from_email', v_from_email, 'from_name', v_from_name,
        'needs_email', true);
    END IF;
    RAISE EXCEPTION 'No valid email address for this client';
  END IF;

  IF p_mode = 'preview' THEN
    RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'html', v_html,
      'excluded', v_excluded, 'invoices', v_list, 'from_email', v_from_email, 'from_name', v_from_name,
      'attachment_name', coalesce(p_attachment->>'filename', ''));
  END IF;

  IF NOT public.is_company_writable(v_company) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'company_archived');
  END IF;
  IF p_attachment IS NULL OR coalesce(btrim(p_attachment->>'filename'), '') = '' OR coalesce(p_attachment->>'content', '') = '' THEN
    RAISE EXCEPTION 'The invoice PDF was not attached';
  END IF;
  IF right(lower(p_attachment->>'filename'), 4) <> '.pdf' THEN
    RAISE EXCEPTION 'The invoice attachment must be a PDF';
  END IF;
  IF length(p_attachment->>'content') > 12000000 THEN
    RAISE EXCEPTION 'The combined invoice PDF is too large to email';
  END IF;

  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Email is not set up'; END IF;

  -- One client email for the whole set. app.invoice_skip_email stops the per-invoice trigger from sending again.
  SELECT net.http_post(
    url := v_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
    body := jsonb_strip_nulls(jsonb_build_object(
      'to', v_to,
      'subject', v_subject,
      'html', v_html,
      'signature_mode', 'person',
      'sender_user_id', v_uid::text,
      'company_id', v_company,
      'from_email', v_from_email,
      'from_name', v_from_name,
      'file_attachments', jsonb_build_array(jsonb_build_object('filename', p_attachment->>'filename', 'content', p_attachment->>'content'))
    ))
  ) INTO v_req;

  PERFORM set_config('app.invoice_skip_email', 'on', true);
  FOREACH v_id IN ARRAY v_included LOOP
    SELECT * INTO inv FROM public.invoices WHERE id = v_id FOR UPDATE;
    UPDATE public.invoices SET
      status = CASE WHEN lower(coalesce(status, '')) = 'draft' THEN 'sent' ELSE status END,
      sent_at = COALESCE(sent_at, now()),
      sent_by = COALESCE(sent_by, v_uid),
      sent_method = COALESCE(NULLIF(btrim(sent_method), ''), 'email'),
      updated_at = now()
    WHERE id = v_id;
    INSERT INTO public.email_events (email_id, event_type, recipient_email, event_data)
    VALUES ('net:' || v_req::text, 'invoice_email_queued', v_to,
      jsonb_build_object('invoice_id', v_id, 'invoice_number', inv.invoice_number, 'net_request_id', v_req, 'trigger', 'bulk_email', 'with', v_numbers, 'to', v_to));
    INSERT INTO public.audit_log (action, company_id, record_id, table_name, user_id, new_data)
    VALUES ('update', v_company, v_id, 'invoices', v_uid,
      jsonb_build_object('event', 'invoice_emailed', 'channel', 'email', 'to', v_to, 'subject', v_subject, 'with', v_numbers, 'net_request_id', v_req));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'to', v_to, 'subject', v_subject, 'net_request_id', v_req,
    'sent_at', now(), 'email_count', 1, 'invoices', v_list, 'excluded', v_excluded);
END
$function$;

REVOKE ALL ON FUNCTION public.send_invoices_email(uuid[], text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_invoices_email(uuid[], text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.send_invoices_email(uuid[], text, text, jsonb) IS
  'One email for several invoices of the same client. Does not change invoice amounts or numbers.';
