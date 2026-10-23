-- 0026: ONE alert per accept.
-- The "<Client> accepted Q-x" invoice alert (0025) now also replaces the two older notices on accept:
--   * 'quote_accepted_handover' ("Quote X accepted — hand to technician", p3_notify_quote_accepted)
--   * 'quote_status_change' titled "Quote Accepted" (notify_quote_status_change)
-- It keeps their useful info: metadata.handover_link (/admin/visits/<lead> or /admin/estimates/<quote>) and lead_id; the app
-- shows a "Hand to technician" button. The old notices still fire when no deposit invoice/approval is created (fallback),
-- and every other status change ("Quote Sent", "Quote Viewed", ...) is unchanged.
-- Also: the deposit amount in the alert uses the SA format via fmt_rand_sql ("R 27 421,32").
-- Rollback: drizzle/rollback/0026_accept_alert_merge_rollback.sql

CREATE OR REPLACE FUNCTION public.isa_queue(p_invoice_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.invoices%ROWTYPE; q public.quotes%ROWTYPE; v_min integer; v_due timestamptz; v_id uuid;
  v_client text; v_dep numeric; v_body text; v_handover text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = inv.quote_id;
  SELECT cs.invoice_auto_send_minutes INTO v_min FROM public.company_settings cs
   WHERE cs.company_id = inv.company_id ORDER BY cs.is_primary DESC, cs.updated_at DESC NULLS LAST, cs.id LIMIT 1;
  v_min := COALESCE(v_min, 15);
  v_due := CASE WHEN v_min > 0 THEN now() + make_interval(mins => v_min) END;
  -- 0026: keep the hand-to-technician link (same rule and target as p3_notify_quote_accepted)
  IF q.id IS NOT NULL AND NOT COALESCE(q.is_variation, false)
     AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.quote_id = q.id AND j.job_type = 'installation') THEN
    v_handover := CASE WHEN q.lead_id IS NOT NULL THEN '/admin/visits/' || q.lead_id::text ELSE '/admin/estimates/' || q.id::text END;
  END IF;
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

  v_body := 'Invoice ' || COALESCE(inv.invoice_number, '') || ' (deposit ' || public.fmt_rand_sql(v_dep) || ') is ready. '
    || CASE WHEN v_due IS NULL THEN 'Nothing has been sent yet. Send it when ready.'
            ELSE 'It sends to the client automatically at ' || to_char(v_due AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
                 || ' unless you send it now or hold it.' END;
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT u, 'quote_accepted_send_invoice', v_client || ' accepted ' || COALESCE(q.quote_number, 'the quote'), v_body, inv.id,
    jsonb_build_object('invoice_id', inv.id, 'quote_id', inv.quote_id, 'approval_id', v_id, 'due_at', v_due,
                       'link', '/admin/invoices/' || inv.id, 'lead_id', q.lead_id, 'handover_link', v_handover)
  FROM public.isa_recipients(inv.company_id, q.sales_engineer_id) u;

  -- 0026: this alert replaces the old 'Quote X accepted — hand to technician' and 'Quote Accepted' notices for this accept.
  -- Mark the quote for this transaction (the old triggers check it) and remove any old notice already written in this
  -- same transaction for the people who just got the new alert (covers either trigger order).
  PERFORM set_config('app.isa_alerted_quotes',
    COALESCE(NULLIF(current_setting('app.isa_alerted_quotes', true), ''), ',') || q.id::text || ',', true);
  DELETE FROM public.notifications n
   WHERE n.related_id = q.id AND n.created_at = now()
     AND (n.type = 'quote_accepted_handover' OR (n.type = 'quote_status_change' AND n.title = 'Quote Accepted'))
     AND n.user_id IN (SELECT u FROM public.isa_recipients(inv.company_id, q.sales_engineer_id) u);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.isa_queue(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.p3_notify_quote_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'accepted' AND lower(COALESCE(OLD.status, '')) <> 'accepted'
     AND NEW.sales_engineer_id IS NOT NULL AND NOT NEW.is_variation /*r2*/
     AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE quote_id = NEW.id AND job_type = 'installation')
     AND position(',' || NEW.id::text || ',' IN COALESCE(current_setting('app.isa_alerted_quotes', true), '')) = 0 /*0026: merged into the invoice alert*/ THEN
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
    -- 0026: on accept, the invoice alert already told the rep/admins; skip the separate "Quote Accepted" notice
    IF NEW.status = 'accepted'
       AND position(',' || NEW.id::text || ',' IN COALESCE(current_setting('app.isa_alerted_quotes', true), '')) > 0 THEN
      RETURN NEW;
    END IF;
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
