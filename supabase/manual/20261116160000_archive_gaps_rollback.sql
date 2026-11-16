-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Undoes 20261116160000_archive_gaps.sql.
-- Does not un-archive quotes or leads, and does not change invoices or payments.
-- Invoice 0001771 is left as it is.

DROP TRIGGER IF EXISTS invoices_archive_status_guard ON public.invoices;
DROP FUNCTION IF EXISTS public.invoices_archive_status_guard();

-- Ageing report: remove the archived / void filter added by the migration.
DO $aging$
DECLARE d text := pg_get_functiondef('public.get_invoice_aging_report()'::regprocedure);
  extra text := ' AND i.archived_at IS NULL AND lower(coalesce(i.status, '''')) NOT IN (''void'', ''cancelled'', ''canceled'') /*archive-gaps*/';
BEGIN
  IF position(extra in d) > 0 THEN
    EXECUTE replace(d, extra, '');
  END IF;
END $aging$;

CREATE OR REPLACE FUNCTION public._archive_gaps_unpatch(p_sig text, p_new text, p_old text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text;
BEGIN
  IF to_regprocedure(p_sig) IS NULL THEN RETURN; END IF;
  d := pg_get_functiondef(p_sig::regprocedure);
  IF position(p_new in d) = 0 THEN RETURN; END IF;
  EXECUTE replace(d, p_new, p_old);
END $$;

SELECT public._archive_gaps_unpatch(
  'public.get_public_quote(uuid)',
  $new$  IF v_quote.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('unavailable', true); /*archive-gaps*/
  END IF;$new$,
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.accept_quote_by_token(uuid, text, jsonb)',
  E'\n  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote_id AND archived_at IS NOT NULL) THEN RETURN false; END IF; /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.decline_quote_by_token(uuid)',
  $new$  AND archived_at IS NULL /*archive-gaps*/
$new$,
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.get_quote_by_public_token(uuid)',
  ' AND archived_at IS NULL; /*archive-gaps*/',
  ';'
);

SELECT public._archive_gaps_unpatch(
  'public.public_quote_adjust_data(uuid)',
  E'\n  IF q.archived_at IS NOT NULL THEN RETURN jsonb_build_object(''unavailable'', true); END IF; /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.submit_client_revision(uuid, jsonb, text, text)',
  'IF q.id IS NULL OR q.archived_at IS NOT NULL THEN RAISE EXCEPTION ''This quote is no longer available. Please contact us.''; END IF; /*archive-gaps*/',
  'IF q.id IS NULL THEN RAISE EXCEPTION ''This quote can no longer be changed online.''; END IF;'
);

SELECT public._archive_gaps_unpatch(
  'public.public_quote_bundle(uuid)',
  ' AND q.archived_at IS NULL /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.get_deposit_invoice_by_quote_token(uuid)',
  ' AND q.archived_at IS NULL AND i.archived_at IS NULL /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.public_quote_change_state(uuid)',
  ' AND q.archived_at IS NULL /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.public_quote_drawings(uuid)',
  ' AND q.archived_at IS NULL /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.public_quote_show_unit_cards(uuid)',
  ' AND q.archived_at IS NULL /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.get_customer_invoices_public(uuid)',
  'i.archived_at IS NULL /*archive-gaps*/ and ',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.get_customer_invoices_public(uuid)',
  '''void'',''cancelled'',''canceled'',''draft''',
  '''void'',''cancelled'',''draft'''
);

SELECT public._archive_gaps_unpatch(
  'public.get_customer_portal_data(uuid)',
  ' AND inv.archived_at IS NULL /*archive-gaps*/',
  ''
);

SELECT public._archive_gaps_unpatch(
  'public.get_customer_portal_data(uuid)',
  '''cancelled'',''void'',''canceled''',
  '''cancelled'',''void'''
);

DROP FUNCTION public._archive_gaps_unpatch(text, text, text);

-- Restore the sweep and undo from before this migration (hardcoded 60-day reason, text match only).
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

CREATE OR REPLACE FUNCTION public.quote_aging_undo(p_quote uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote;
  IF q.id IS NULL OR q.company_id IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.quote_aging_log(company_id, quote_id, action, prev_aging_state, prev_archived_at)
  VALUES (q.company_id, q.id, 'undo', q.aging_state, q.archived_at);
  UPDATE public.quotes SET aging_state = null, aging_at = null,
    archived_at = case when archive_reason like 'Auto: Cold%' then null else archived_at end,
    archive_reason = case when archive_reason like 'Auto: Cold%' then null else archive_reason end
  WHERE id = p_quote;
END $$;

DO $q$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.quote_archive(uuid, text)') IS NOT NULL THEN
    d := pg_get_functiondef('public.quote_archive(uuid, text)'::regprocedure);
    IF position(', auto_archived = false' in d) > 0 THEN
      EXECUTE replace(d, ', auto_archived = false', '');
    END IF;
  END IF;
  IF to_regprocedure('public.quote_unarchive(uuid)') IS NOT NULL THEN
    d := pg_get_functiondef('public.quote_unarchive(uuid)'::regprocedure);
    IF position(', auto_archived = false' in d) > 0 THEN
      EXECUTE replace(d, ', auto_archived = false', '');
    END IF;
  END IF;
END $q$;

CREATE OR REPLACE FUNCTION public.lead_archive(p_lead uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.leads;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason for archiving this lead'; END IF;
  IF NOT public.can_close_lead(p_lead) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002'; END IF;
  IF l.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Lead is already archived'; END IF;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('leads', l.id, 'update',
          jsonb_build_object('archived_at', l.archived_at, 'status', l.status),
          jsonb_build_object('event', 'archive', 'reason', btrim(p_reason)),
          auth.uid(), l.company_id);
  UPDATE public.leads
     SET archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason)
   WHERE id = l.id;
  RETURN jsonb_build_object('archived', true, 'lead_id', l.id);
END $$;

CREATE OR REPLACE FUNCTION public.lead_unarchive(p_lead uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l public.leads;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public.can_close_lead(p_lead) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002'; END IF;
  IF l.archived_at IS NULL THEN RAISE EXCEPTION 'Lead is not archived'; END IF;
  UPDATE public.leads
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
   WHERE id = l.id;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('leads', l.id, 'update',
          jsonb_build_object('archived_at', l.archived_at, 'archived_by', l.archived_by, 'archive_reason', l.archive_reason),
          jsonb_build_object('event', 'unarchive'),
          auth.uid(), l.company_id);
  RETURN jsonb_build_object('archived', false, 'lead_id', l.id);
END $$;

ALTER TABLE public.quotes DROP COLUMN IF EXISTS auto_archived;
ALTER TABLE public.leads DROP COLUMN IF EXISTS auto_archived;
