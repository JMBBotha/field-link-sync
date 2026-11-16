-- Open leads ageing. NOT APPLIED by the preview that added this file.
-- Warn at cold_after_days (default 30) is the Home card hint only.
-- Auto-archive at archive_after_days (default 60) runs inside the existing
-- quote-followups cron (quote_aging_sweep), and only when quote_aging_enabled.
-- This turns that switch ON for Massair CT at 60 days.
-- Rollback: supabase/manual/20261116140000_open_lead_auto_archive_rollback.sql
--
-- Activity for a quote is the latest of updated_at (edits and status writes,
-- including a follow-up call saved on the quote), sent_at, viewed_at,
-- quote_followups.created_at, and the linked lead's last_activity_at.
-- A lead with no quote uses last_activity_at, else created_at.
--
-- archived_by is a user id. The cron has no user, so archived_by stays null
-- and the audit row records by = 'system'. Reason text is the one below.
-- Same columns as quote_archive / lead_archive. Nothing is deleted.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE OR REPLACE FUNCTION public.open_lead_auto_archive_preview(p_company uuid default null)
RETURNS TABLE(company_id uuid, kind text, entity_id uuid, quote_number text, customer_name text, status text, last_activity timestamptz, days_idle int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH cfg AS (
    SELECT c.id AS company_id, coalesce(s.archive_after_days, 60) AS days
    FROM public.companies c
    LEFT JOIN public.sales_automation_settings s ON s.company_id = c.id
    WHERE p_company IS NULL OR c.id = p_company
  ),
  quote_rows AS (
    SELECT q.company_id, 'quote'::text AS kind, q.id AS entity_id, q.quote_number, q.customer_name, q.status,
      greatest(
        q.updated_at, q.sent_at, q.viewed_at, q.created_at,
        (SELECT max(f.created_at) FROM public.quote_followups f WHERE f.quote_id = q.id),
        (SELECT l.last_activity_at FROM public.leads l WHERE l.id = q.lead_id)
      ) AS last_activity
    FROM public.quotes q
    JOIN cfg ON cfg.company_id = q.company_id
    WHERE q.archived_at IS NULL
      AND lower(coalesce(q.status, '')) IN ('draft', 'sent', 'viewed')
      AND coalesce(q.is_variation, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.archived_at IS NULL
          AND lower(coalesce(i.status, '')) NOT IN ('void', 'cancelled', 'canceled')
          AND (i.quote_id = q.id OR (q.lead_id IS NOT NULL AND i.lead_id = q.lead_id))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.quote_id = q.id AND j.invoice_id IS NOT NULL
          AND lower(coalesce(j.status, '')) NOT IN ('cancelled', 'canceled')
      )
      AND NOT (
        lower(coalesce(q.status, '')) = 'accepted'
        AND EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.quote_id = q.id AND lower(coalesce(j.status, '')) NOT IN ('cancelled', 'canceled')
        )
      )
  ),
  lead_rows AS (
    SELECT l.company_id, 'lead'::text, l.id, NULL::text, l.customer_name, l.status,
      coalesce(l.last_activity_at, l.created_at)
    FROM public.leads l
    JOIN cfg ON cfg.company_id = l.company_id
    WHERE l.archived_at IS NULL AND l.deleted_at IS NULL AND l.merged_into_id IS NULL
      AND lower(coalesce(l.status, '')) = 'pending'
      AND NOT EXISTS (SELECT 1 FROM public.quotes q WHERE q.lead_id = l.id AND q.archived_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.lead_id = l.id AND i.archived_at IS NULL
          AND lower(coalesce(i.status, '')) NOT IN ('void', 'cancelled', 'canceled')
      )
  )
  SELECT x.company_id, x.kind, x.entity_id, x.quote_number, x.customer_name, x.status, x.last_activity,
         (current_date - x.last_activity::date)::int
  FROM (
    SELECT * FROM quote_rows
    UNION ALL
    SELECT * FROM lead_rows
  ) x
  JOIN cfg ON cfg.company_id = x.company_id
  WHERE x.last_activity IS NOT NULL
    AND x.last_activity < now() - make_interval(days => cfg.days);
$$;
REVOKE ALL ON FUNCTION public.open_lead_auto_archive_preview(uuid) FROM PUBLIC, anon, authenticated;

-- Cold marking stays. Archive-by-sent-date is replaced by the activity rule above.
CREATE OR REPLACE FUNCTION public.quote_aging_candidates(p_company uuid default null)
RETURNS TABLE(company_id uuid, quote_id uuid, quote_number text, sent_at timestamptz, days_since_sent int, action text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT q.company_id, q.id, q.quote_number, q.sent_at, (current_date - q.sent_at::date)::int, 'cold'::text
  FROM public.quotes q
  LEFT JOIN public.sales_automation_settings s ON s.company_id = q.company_id
  WHERE q.archived_at IS NULL AND q.sent_at IS NOT NULL AND q.status IN ('sent', 'viewed')
    AND coalesce(q.is_variation, false) = false
    AND q.aging_state IS DISTINCT FROM 'cold'
    AND (p_company IS NULL OR q.company_id = p_company)
    AND (current_date - q.sent_at::date) >= coalesce(s.cold_after_days, 30)
    AND NOT EXISTS (
      SELECT 1 FROM public.quotes a WHERE a.id <> q.id AND a.status = 'accepted' AND a.company_id IS NOT DISTINCT FROM q.company_id
        AND ((q.option_group_id IS NOT NULL AND a.option_group_id = q.option_group_id)
          OR (q.lead_id IS NOT NULL AND a.lead_id = q.lead_id AND a.customer_id IS NOT DISTINCT FROM q.customer_id))
    );
$$;
REVOKE ALL ON FUNCTION public.quote_aging_candidates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quote_aging_sweep(p_force boolean default false)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT c.* FROM public.quote_aging_candidates(null) c
           JOIN public.sales_automation_settings s ON s.company_id = c.company_id
           WHERE s.quote_aging_enabled AND (p_force OR s.last_aging_run IS DISTINCT FROM current_date) LOOP
    INSERT INTO public.quote_aging_log(company_id, quote_id, action, prev_aging_state)
      SELECT q.company_id, q.id, 'cold', q.aging_state FROM public.quotes q WHERE q.id = r.quote_id;
    UPDATE public.quotes SET aging_state = 'cold', aging_at = now() WHERE id = r.quote_id;
    n := n + 1;
  END LOOP;

  FOR r IN SELECT p.* FROM public.open_lead_auto_archive_preview(null) p
           JOIN public.sales_automation_settings s ON s.company_id = p.company_id
           WHERE s.quote_aging_enabled AND (p_force OR s.last_aging_run IS DISTINCT FROM current_date) LOOP
    IF r.kind = 'quote' THEN
      INSERT INTO public.quote_aging_log(company_id, quote_id, action, prev_aging_state, prev_archived_at)
        SELECT q.company_id, q.id, 'archived', q.aging_state, q.archived_at FROM public.quotes q WHERE q.id = r.entity_id;
      UPDATE public.quotes
         SET archived_at = now(), archived_by = NULL,
             archive_reason = 'Auto-archived: 60 days no activity',
             aging_state = 'cold', aging_at = coalesce(aging_at, now())
       WHERE id = r.entity_id AND archived_at IS NULL;
      INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('quotes', r.entity_id, 'update', jsonb_build_object('archived_at', null),
              jsonb_build_object('event', 'archive', 'by', 'system', 'reason', 'Auto-archived: 60 days no activity'),
              NULL, r.company_id);
    ELSE
      UPDATE public.leads
         SET archived_at = now(), archived_by = NULL, archive_reason = 'Auto-archived: 60 days no activity'
       WHERE id = r.entity_id AND archived_at IS NULL;
      INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('leads', r.entity_id, 'update', jsonb_build_object('archived_at', null),
              jsonb_build_object('event', 'archive', 'by', 'system', 'reason', 'Auto-archived: 60 days no activity'),
              NULL, r.company_id);
    END IF;
    n := n + 1;
  END LOOP;

  UPDATE public.sales_automation_settings SET last_aging_run = current_date, updated_at = now() WHERE quote_aging_enabled;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.quote_aging_sweep(boolean) FROM PUBLIC, anon, authenticated;

INSERT INTO public.sales_automation_settings (company_id, quote_aging_enabled, cold_after_days, archive_after_days)
VALUES ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e', true, 30, 60)
ON CONFLICT (company_id) DO UPDATE
  SET quote_aging_enabled = true,
      cold_after_days = 30,
      archive_after_days = 60,
      updated_at = now();
