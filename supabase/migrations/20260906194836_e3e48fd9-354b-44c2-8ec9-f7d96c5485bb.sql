CREATE EXTENSION IF NOT EXISTS pg_net;

-- Locked single-row config holding the shared webhook token between triggers and the edge function
CREATE TABLE public.app_webhook_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email_webhook_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_webhook_config TO service_role;
ALTER TABLE public.app_webhook_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.app_webhook_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Trigger function: fires when quotes/invoices transition to 'sent'
CREATE OR REPLACE FUNCTION public.notify_document_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_token uuid;
  v_email text;
  v_name text;
  v_company text;
  v_doc_number text;
  v_total numeric;
  v_items_html text;
  v_portal_link text;
  v_subject text;
  v_html text;
  v_app_url text := 'https://field-link-sync.lovable.app';
  v_fn_url text := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/send-transactional-email';
BEGIN
  SELECT email_webhook_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_company FROM public.companies WHERE companies.id = NEW.company_id;
  v_company := COALESCE(v_company, '0800-BE-COOL');

  IF TG_TABLE_NAME = 'quotes' THEN
    v_doc_number := COALESCE(NEW.quote_number, 'Quote');
    v_total := COALESCE(NEW.total, 0);

    SELECT COALESCE(NULLIF(trim(c.first_name || ' ' || COALESCE(c.last_name, '')), ''), c.name), c.email
      INTO v_name, v_email
      FROM public.customers c WHERE c.id = NEW.customer_id;
    IF v_email IS NULL OR v_email = '' THEN
      SELECT l.email, l.customer_name INTO v_email, v_name FROM public.leads l WHERE l.id = NEW.lead_id;
    END IF;

    SELECT string_agg(
      '<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      replace(replace(COALESCE(qi.description, 'Item'), '<', '&lt;'), '>', '&gt;') ||
      '</td><td align="center" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      COALESCE(qi.quantity::text, '1') ||
      '</td><td align="right" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">R ' ||
      to_char(COALESCE(qi.unit_price, 0) * COALESCE(qi.quantity, 1), 'FM999G999G990D00') ||
      '</td></tr>', '')
      INTO v_items_html
      FROM public.quote_items qi WHERE qi.quote_id = NEW.id;

    IF NEW.public_token IS NOT NULL THEN
      v_portal_link := v_app_url || '/quote/' || NEW.public_token;
    END IF;

    v_subject := 'Your quote from ' || v_company;
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    v_doc_number := COALESCE(NEW.invoice_number, 'Invoice');
    v_total := COALESCE(NEW.grand_total, 0);
    v_name := NEW.customer_name;
    v_email := NEW.customer_email;
    IF v_email IS NULL OR v_email = '' THEN
      SELECT c.email INTO v_email FROM public.customers c WHERE c.id = NEW.customer_id;
    END IF;

    SELECT string_agg(
      '<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      replace(replace(COALESCE(ii.description, 'Item'), '<', '&lt;'), '>', '&gt;') ||
      '</td><td align="center" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">' ||
      COALESCE(ii.quantity::text, '1') ||
      '</td><td align="right" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">R ' ||
      to_char(COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1), 'FM999G999G990D00') ||
      '</td></tr>', '')
      INTO v_items_html
      FROM public.invoice_items ii WHERE ii.invoice_id = NEW.id;

    v_subject := 'Your invoice from ' || v_company;
  ELSE
    RETURN NEW;
  END IF;

  -- No recipient: nothing to do
  IF v_email IS NULL OR trim(v_email) = '' THEN
    RETURN NEW;
  END IF;

  v_html := '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    || '<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;"><tr><td align="center" style="padding:24px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">'
    || '<tr><td style="background-color:#1B3A5C;padding:24px 32px;text-align:center;"><h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">' || v_company || '</h1></td></tr>'
    || '<tr><td style="background-color:#F59E0B;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    || '<tr><td style="padding:28px 32px;">'
    || '<p style="margin:0 0 16px;font-size:15px;color:#111827;">Dear <strong>' || replace(replace(COALESCE(v_name, 'Valued Customer'), '<', '&lt;'), '>', '&gt;') || '</strong>,</p>'
    || '<p style="margin:0 0 20px;font-size:14px;color:#374151;">Please find your ' || lower(TG_TABLE_NAME = 'quotes'::text)::text || '</p>'
    || '</td></tr></table></td></tr></table></body></html>';

  -- Rebuild body properly (clearer than inline concat above)
  v_html := '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    || '<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,sans-serif;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;"><tr><td align="center" style="padding:24px 16px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">'
    || '<tr><td style="background-color:#1B3A5C;padding:24px 32px;text-align:center;"><h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">' || v_company || '</h1>'
    || '<p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">' || v_doc_number || '</p></td></tr>'
    || '<tr><td style="background-color:#F59E0B;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>'
    || '<tr><td style="padding:28px 32px;">'
    || '<p style="margin:0 0 16px;font-size:15px;color:#111827;">Dear <strong>' || replace(replace(COALESCE(v_name, 'Valued Customer'), '<', '&lt;'), '>', '&gt;') || '</strong>,</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">'
    || '<tr><th align="left" style="padding:8px 12px;border-bottom:2px solid #1B3A5C;font-size:12px;color:#6b7280;text-transform:uppercase;">Item</th>'
    || '<th align="center" style="padding:8px 12px;border-bottom:2px solid #1B3A5C;font-size:12px;color:#6b7280;text-transform:uppercase;">Qty</th>'
    || '<th align="right" style="padding:8px 12px;border-bottom:2px solid #1B3A5C;font-size:12px;color:#6b7280;text-transform:uppercase;">Amount</th></tr>'
    || COALESCE(v_items_html, '<tr><td colspan="3" style="padding:8px 12px;font-size:14px;color:#6b7280;">See attached details</td></tr>')
    || '</table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px;">'
    || '<tr><td style="padding:16px 20px;"><p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;">Total (incl. VAT)</p>'
    || '<p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#1B3A5C;">R ' || to_char(v_total, 'FM999G999G990D00') || '</p></td></tr></table>'
    || CASE WHEN v_portal_link IS NOT NULL THEN
         '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;"><tr><td style="background-color:#F59E0B;border-radius:8px;">'
         || '<a href="' || v_portal_link || '" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#1B3A5C;text-decoration:none;">View &amp; Accept Your Quote</a></td></tr></table>'
         || '<p style="margin:0 0 8px;font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: <a href="' || v_portal_link || '" style="color:#1B3A5C;">' || v_portal_link || '</a></p>'
       ELSE '' END
    || '<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">You are receiving this email because ' || v_company || ' prepared this document for you. If you did not expect it, please ignore it or contact us.</p>'
    || '</td></tr></table></td></tr></table></body></html>';

  PERFORM net.http_post(
    url := v_fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-webhook-token', v_token::text),
    body := jsonb_build_object('to', v_email, 'subject', v_subject, 'html', v_html)
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_quotes_sent_email
  AFTER UPDATE ON public.quotes
  FOR EACH ROW
  WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent')
  EXECUTE FUNCTION public.notify_document_sent();

CREATE TRIGGER trg_invoices_sent_email
  AFTER UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent')
  EXECUTE FUNCTION public.notify_document_sent();