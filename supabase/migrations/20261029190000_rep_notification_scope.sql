-- Sales reps only get notifications about their own leads / jobs / quotes / offers (Johan 29 Oct 17:39).
-- Office-dispatch alerts (new manual lead, no agents available, watchdog, specials, unit content, applicants) are admin/office only.
-- One guard on INSERT so every trigger, cron and edge function is covered.
CREATE OR REPLACE FUNCTION public.notification_rep_allowed(_uid uuid, _type text, _related uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_lead uuid; v_rep uuid;
BEGIN
  IF NOT public.is_sales_rep(_uid) THEN RETURN true; END IF;
  _type := lower(coalesce(_type, ''));
  -- office-only alerts
  IF _type IN ('no_agents_available','new_lead','job_watchdog','special_ending','unit_content_draft','invoice_ready_to_send','call_logged')
     OR _type LIKE 'network_%' OR _type LIKE 'lead_sla%' THEN
    -- the SLA nudge is personal when the rep owns the lead
    IF _type LIKE 'lead_sla%' AND _related IS NOT NULL AND public.rep_follows_lead(_uid, _related) THEN RETURN true; END IF;
    RETURN false;
  END IF;
  -- personal by construction: offers / assignments / nudges / requests routed to this rep
  IF _type IN ('sales_nudge','lead_assigned') OR _type LIKE 'lead_offer%' OR _type LIKE 'request_%' THEN RETURN true; END IF;
  IF _related IS NULL THEN RETURN false; END IF;
  -- resolve the lead / quote rep behind related_id
  IF EXISTS (SELECT 1 FROM leads WHERE id = _related) THEN v_lead := _related;
  ELSE
    SELECT lead_id INTO v_lead FROM jobs WHERE id = _related;
    IF v_lead IS NULL THEN SELECT lead_id, sales_engineer_id INTO v_lead, v_rep FROM quotes WHERE id = _related; END IF;
    IF v_lead IS NULL AND v_rep IS NULL THEN
      SELECT coalesce(i.lead_id, q.lead_id), q.sales_engineer_id INTO v_lead, v_rep
      FROM invoices i LEFT JOIN quotes q ON q.id = i.quote_id WHERE i.id = _related;
    END IF;
  END IF;
  IF v_rep = _uid THEN RETURN true; END IF;
  IF v_lead IS NOT NULL AND public.rep_follows_lead(_uid, v_lead) THEN RETURN true; END IF;
  IF v_lead IS NOT NULL AND EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = v_lead AND q.sales_engineer_id = _uid) THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.notifications_rep_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.notification_rep_allowed(NEW.user_id, NEW.type, NEW.related_id) THEN RETURN NEW; END IF;
  RETURN NULL; -- silently not delivered to this rep
END $$;

DROP TRIGGER IF EXISTS trg_notifications_rep_scope ON public.notifications;
CREATE TRIGGER trg_notifications_rep_scope BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_rep_scope();
