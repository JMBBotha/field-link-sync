-- Rollback for 0026: restores the exact pre-0026 (live, md5-checked 23 Oct) bodies of the three functions.
-- After running, also: DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <0026 journal when>;

CREATE OR REPLACE FUNCTION public.isa_queue(p_invoice_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv public.invoices%ROWTYPE; q public.quotes%ROWTYPE; v_min integer; v_due timestamptz; v_id uuid;
  v_client text; v_dep numeric; v_body text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = inv.quote_id;
  SELECT cs.invoice_auto_send_minutes INTO v_min FROM public.company_settings cs
   WHERE cs.company_id = inv.company_id ORDER BY cs.is_primary DESC, cs.updated_at DESC NULLS LAST, cs.id LIMIT 1;
  v_min := COALESCE(v_min, 15);
  v_due := CASE WHEN v_min > 0 THEN now() + make_interval(mins => v_min) END;
  v_client := COALESCE(NULLIF(btrim(inv.customer_name), ''), NULLIF(btrim(q.customer_name), ''), 'Client');
  v_dep := COALESCE(inv.deposit_amount,
                    CASE WHEN inv.deposit_type = 'percent' THEN ROUND(COALESCE(inv.grand_total,0) * COALESCE(inv.deposit_value,0) / 100.0, 2) END,
                    inv.grand_total);

  INSERT INTO public.invoice_send_approvals (invoice_id, quote_id, company_id, rep_id, client_name, quote_number,
    invoice_number, deposit_amount, status, due_at)
  VALUES (inv.id, inv.quote_id, inv.company_id, q.sales_engineer_id, v_client, q.quote_number,
    inv.invoice_number, v_dep, 'pending', v_due)
  ON CONFLICT (invoice_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN (SELECT id FROM public.invoice_send_approvals WHERE invoice_id = inv.id); END IF;

  INSERT INTO public.invoice_send_events (approval_id, invoice_id, actor_id, action, note)
  VALUES (v_id, inv.id, auth.uid(), 'queued',
          CASE WHEN v_due IS NULL THEN 'auto-send off' ELSE 'auto-send at ' || to_char(v_due AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') || ' SAST' END);

  v_body := 'Invoice ' || COALESCE(inv.invoice_number, '') || ' (deposit R ' || to_char(v_dep, 'FM999999990.00') || ') is ready. '
    || CASE WHEN v_due IS NULL THEN 'Nothing has been sent yet. Send it when ready.'
            ELSE 'It sends to the client automatically at ' || to_char(v_due AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
                 || ' unless you send it now or hold it.' END;
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT u, 'quote_accepted_send_invoice', v_client || ' accepted ' || COALESCE(q.quote_number, 'the quote'), v_body, inv.id,
    jsonb_build_object('invoice_id', inv.id, 'quote_id', inv.quote_id, 'approval_id', v_id, 'due_at', v_due,
                       'link', '/admin/invoices/' || inv.id)
  FROM public.isa_recipients(inv.company_id, q.sales_engineer_id) u;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.p3_notify_quote_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'accepted' AND lower(COALESCE(OLD.status, '')) <> 'accepted'
     AND NEW.sales_engineer_id IS NOT NULL AND NOT NEW.is_variation /*r2*/
     AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE quote_id = NEW.id AND job_type = 'installation') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (NEW.sales_engineer_id, 'quote_accepted_handover',
            'Quote ' || COALESCE(NEW.quote_number, '') || ' accepted — hand to technician',
            COALESCE(NEW.customer_name, 'Client') || ' accepted. Open the visit to hand it over.', NEW.id,
            jsonb_build_object('quote_id', NEW.id, 'lead_id', NEW.lead_id,
              'link', CASE WHEN NEW.lead_id IS NOT NULL THEN '/admin/visits/' || NEW.lead_id::text ELSE '/admin/estimates/' || NEW.id::text END));
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.notify_quote_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.sales_engineer_id,
      'quote_status_change',
      'Quote ' || INITCAP(NEW.status),
      'Quote ' || NEW.quote_number || ' has been ' || NEW.status,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.isa_queue(uuid) FROM public, anon, authenticated;
