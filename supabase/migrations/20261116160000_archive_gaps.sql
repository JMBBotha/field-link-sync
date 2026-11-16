-- Archive gaps. NOT APPLIED by the preview that added this file.
-- Does not change invoice or payment rows. Invoice 0001771 is left as it is.
--
-- 1. quote_aging_sweep writes auto_archived and a reason that uses archive_after_days.
--    quote_aging_undo clears that flag, and still clears the older reason texts.
-- 2. Closing or dismissing a lead is not done here. The app hides that lead's
--    still-open quote. This migration does not touch those quotes.
-- 3. get_invoice_aging_report skips archived and void/cancelled invoices.
-- 4. invoices.archived_at may be set only when status is void or cancelled.
--    The check runs when archived_at changes, so an already-archived overdue
--    row (0001771) can still be updated in other columns.
-- 5. Public quote and invoice RPCs refuse archived rows.
--
-- Writers of invoices.archived_at found in this repo, besides archive_void_invoice:
--   * supabase/migrations/20261028160000_quote_options_move_back.sql
--     UPDATE invoices SET status='void', archived_at=now() — allowed, status is void.
--   * No app, import, Mandy, or outbox update sets invoices.archived_at.
--     Staff can still UPDATE the column through the API. This trigger blocks that
--     unless the invoice is void or cancelled.
-- Rollback: supabase/manual/20261116160000_archive_gaps_rollback.sql

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS auto_archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS auto_archived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quotes.auto_archived IS
  'Set by quote_aging_sweep. quote_aging_undo clears it. Manual quote_archive leaves it false.';
COMMENT ON COLUMN public.leads.auto_archived IS
  'Set by quote_aging_sweep for a lead with no quote. lead_unarchive clears it.';

-- Mark rows the sweep already archived, so undo does not depend on the reason text alone.
-- Does not change archived_at, status, invoices, or payments.
UPDATE public.quotes
   SET auto_archived = true
 WHERE auto_archived = false
   AND archived_at IS NOT NULL
   AND (archive_reason LIKE 'Auto: Cold%' OR archive_reason LIKE 'Auto-archived:%');

UPDATE public.leads
   SET auto_archived = true
 WHERE auto_archived = false
   AND archived_at IS NOT NULL
   AND (archive_reason LIKE 'Auto: Cold%' OR archive_reason LIKE 'Auto-archived:%');

CREATE OR REPLACE FUNCTION public.quote_aging_sweep(p_force boolean default false)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n int := 0; v_reason text;
BEGIN
  FOR r IN SELECT c.* FROM public.quote_aging_candidates(null) c
           JOIN public.sales_automation_settings s ON s.company_id = c.company_id
           WHERE s.quote_aging_enabled AND (p_force OR s.last_aging_run IS DISTINCT FROM current_date) LOOP
    INSERT INTO public.quote_aging_log(company_id, quote_id, action, prev_aging_state)
      SELECT q.company_id, q.id, 'cold', q.aging_state FROM public.quotes q WHERE q.id = r.quote_id;
    UPDATE public.quotes SET aging_state = 'cold', aging_at = now() WHERE id = r.quote_id;
    n := n + 1;
  END LOOP;

  FOR r IN SELECT p.*, coalesce(s.archive_after_days, 60) AS archive_days
           FROM public.open_lead_auto_archive_preview(null) p
           JOIN public.sales_automation_settings s ON s.company_id = p.company_id
           WHERE s.quote_aging_enabled AND (p_force OR s.last_aging_run IS DISTINCT FROM current_date) LOOP
    v_reason := format('Auto-archived: %s days no activity', r.archive_days);
    IF r.kind = 'quote' THEN
      INSERT INTO public.quote_aging_log(company_id, quote_id, action, prev_aging_state, prev_archived_at)
        SELECT q.company_id, q.id, 'archived', q.aging_state, q.archived_at FROM public.quotes q WHERE q.id = r.entity_id;
      UPDATE public.quotes
         SET archived_at = now(), archived_by = NULL, auto_archived = true,
             archive_reason = v_reason,
             aging_state = 'cold', aging_at = coalesce(aging_at, now())
       WHERE id = r.entity_id AND archived_at IS NULL;
      INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('quotes', r.entity_id, 'update', jsonb_build_object('archived_at', null),
              jsonb_build_object('event', 'archive', 'by', 'system', 'reason', v_reason, 'auto_archived', true),
              NULL, r.company_id);
    ELSE
      UPDATE public.leads
         SET archived_at = now(), archived_by = NULL, auto_archived = true, archive_reason = v_reason
       WHERE id = r.entity_id AND archived_at IS NULL;
      INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
      VALUES ('leads', r.entity_id, 'update', jsonb_build_object('archived_at', null),
              jsonb_build_object('event', 'archive', 'by', 'system', 'reason', v_reason, 'auto_archived', true),
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
DECLARE q record; v_auto boolean;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote;
  IF q.id IS NULL OR q.company_id IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  v_auto := coalesce(q.auto_archived, false)
    OR coalesce(q.archive_reason, '') LIKE 'Auto: Cold%'
    OR coalesce(q.archive_reason, '') LIKE 'Auto-archived:%';
  INSERT INTO public.quote_aging_log(company_id, quote_id, action, prev_aging_state, prev_archived_at)
  VALUES (q.company_id, q.id, 'undo', q.aging_state, q.archived_at);
  UPDATE public.quotes SET
    aging_state = NULL,
    aging_at = NULL,
    archived_at = CASE WHEN v_auto THEN NULL ELSE archived_at END,
    archived_by = CASE WHEN v_auto THEN NULL ELSE archived_by END,
    archive_reason = CASE WHEN v_auto THEN NULL ELSE archive_reason END,
    auto_archived = CASE WHEN v_auto THEN false ELSE auto_archived END
  WHERE id = p_quote;
END $$;
GRANT EXECUTE ON FUNCTION public.quote_aging_undo(uuid) TO authenticated;

-- Manual archive is not an auto-archive. Unarchive clears the flag.
DO $patch$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.quote_archive(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'quote_archive missing';
  END IF;
  d := pg_get_functiondef('public.quote_archive(uuid, text)'::regprocedure);
  IF position('auto_archived' in d) = 0 THEN
    IF position('archive_reason = btrim(p_reason)' in d) = 0 THEN
      RAISE EXCEPTION 'quote_archive anchor missing';
    END IF;
    EXECUTE replace(d, 'archive_reason = btrim(p_reason)', 'archive_reason = btrim(p_reason), auto_archived = false');
  END IF;

  d := pg_get_functiondef('public.quote_unarchive(uuid)'::regprocedure);
  IF position('auto_archived' in d) = 0 THEN
    IF position('archived_at = NULL, archived_by = NULL, archive_reason = NULL' in d) = 0 THEN
      RAISE EXCEPTION 'quote_unarchive anchor missing';
    END IF;
    EXECUTE replace(d, 'archived_at = NULL, archived_by = NULL, archive_reason = NULL',
      'archived_at = NULL, archived_by = NULL, archive_reason = NULL, auto_archived = false');
  END IF;
END $patch$;

CREATE OR REPLACE FUNCTION public.lead_archive(p_lead uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.leads;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for archiving this lead';
  END IF;
  IF NOT public.can_close_lead(p_lead) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF l.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Lead is already archived';
  END IF;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('leads', l.id, 'update',
          jsonb_build_object('archived_at', l.archived_at, 'status', l.status),
          jsonb_build_object('event', 'archive', 'reason', btrim(p_reason)),
          auth.uid(), l.company_id);
  UPDATE public.leads
     SET archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason), auto_archived = false
   WHERE id = l.id;
  RETURN jsonb_build_object('archived', true, 'lead_id', l.id);
END $$;

CREATE OR REPLACE FUNCTION public.lead_unarchive(p_lead uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.leads;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_close_lead(p_lead) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF l.archived_at IS NULL THEN
    RAISE EXCEPTION 'Lead is not archived';
  END IF;
  UPDATE public.leads
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, auto_archived = false
   WHERE id = l.id;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('leads', l.id, 'update',
          jsonb_build_object('archived_at', l.archived_at, 'archived_by', l.archived_by, 'archive_reason', l.archive_reason),
          jsonb_build_object('event', 'unarchive'),
          auth.uid(), l.company_id);
  RETURN jsonb_build_object('archived', false, 'lead_id', l.id);
END $$;

-- Ageing report: drop archived and void/cancelled, same idea as the Home tiles.
-- Keeps the company filter and any credit-note subtraction already in the function.
DO $aging$
DECLARE d text := pg_get_functiondef('public.get_invoice_aging_report()'::regprocedure);
BEGIN
  IF position('/*archive-gaps*/' in d) > 0 THEN
    RETURN;
  END IF;
  IF position('AND i.due_date IS NOT NULL' in d) = 0 THEN
    RAISE EXCEPTION 'get_invoice_aging_report anchor missing';
  END IF;
  EXECUTE replace(d, 'AND i.due_date IS NOT NULL',
    'AND i.due_date IS NOT NULL AND i.archived_at IS NULL AND lower(coalesce(i.status, '''')) NOT IN (''void'', ''cancelled'', ''canceled'') /*archive-gaps*/');
END $aging$;

-- archived_at may be set only on a void or cancelled invoice, and only when it changes.
CREATE OR REPLACE FUNCTION public.invoices_archive_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
     AND lower(coalesce(NEW.status, '')) NOT IN ('void', 'cancelled', 'canceled') THEN
    RAISE EXCEPTION 'Only a void or cancelled invoice can be archived'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoices_archive_status_guard ON public.invoices;
CREATE TRIGGER invoices_archive_status_guard
  BEFORE INSERT OR UPDATE OF archived_at ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.invoices_archive_status_guard();

-- Public links. Each patch is skipped once the marker is present.
CREATE OR REPLACE FUNCTION public._archive_gaps_patch(p_sig text, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE d text;
BEGIN
  IF to_regprocedure(p_sig) IS NULL THEN
    RAISE EXCEPTION 'archive-gaps: % missing', p_sig;
  END IF;
  d := pg_get_functiondef(p_sig::regprocedure);
  IF position(p_new in d) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old in d) = 0 THEN
    RAISE EXCEPTION 'archive-gaps anchor missing in %', p_sig;
  END IF;
  EXECUTE replace(d, p_old, p_new);
END $$;

SELECT public._archive_gaps_patch(
  'public.get_public_quote(uuid)',
  $old$  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;$old$,
  $new$  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_quote.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('unavailable', true); /*archive-gaps*/
  END IF;$new$
);

SELECT public._archive_gaps_patch(
  'public.accept_quote_by_token(uuid, text, jsonb)',
  'IF v_quote_id IS NULL THEN RETURN false; END IF;',
  E'IF v_quote_id IS NULL THEN RETURN false; END IF;\n  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote_id AND archived_at IS NOT NULL) THEN RETURN false; END IF; /*archive-gaps*/'
);

SELECT public._archive_gaps_patch(
  'public.decline_quote_by_token(uuid)',
  $old$  WHERE public_token = p_token
  AND status IN ('sent', 'viewed', 'draft');$old$,
  $new$  WHERE public_token = p_token
  AND archived_at IS NULL /*archive-gaps*/
  AND status IN ('sent', 'viewed', 'draft');$new$
);

SELECT public._archive_gaps_patch(
  'public.get_quote_by_public_token(uuid)',
  $old$  WHERE public_token = p_token;$old$,
  $new$  WHERE public_token = p_token AND archived_at IS NULL; /*archive-gaps*/$new$
);

SELECT public._archive_gaps_patch(
  'public.public_quote_adjust_data(uuid)',
  'IF q.id IS NULL THEN RETURN NULL; END IF;',
  E'IF q.id IS NULL THEN RETURN NULL; END IF;\n  IF q.archived_at IS NOT NULL THEN RETURN jsonb_build_object(''unavailable'', true); END IF; /*archive-gaps*/'
);

SELECT public._archive_gaps_patch(
  'public.submit_client_revision(uuid, jsonb, text, text)',
  'IF q.id IS NULL THEN RAISE EXCEPTION ''This quote can no longer be changed online.''; END IF;',
  E'IF q.id IS NULL OR q.archived_at IS NOT NULL THEN RAISE EXCEPTION ''This quote is no longer available. Please contact us.''; END IF; /*archive-gaps*/'
);

SELECT public._archive_gaps_patch(
  'public.public_quote_bundle(uuid)',
  'AND q.status <> ''draft''',
  'AND q.status <> ''draft'' AND q.archived_at IS NULL /*archive-gaps*/'
);

SELECT public._archive_gaps_patch(
  'public.get_deposit_invoice_by_quote_token(uuid)',
  'WHERE q.public_token = p_token',
  'WHERE q.public_token = p_token AND q.archived_at IS NULL AND i.archived_at IS NULL /*archive-gaps*/'
);

SELECT public._archive_gaps_patch(
  'public.public_quote_change_state(uuid)',
  'WHERE q.public_token = p_token AND r.status = ''open''',
  'WHERE q.public_token = p_token AND q.archived_at IS NULL /*archive-gaps*/ AND r.status = ''open'''
);

SELECT public._archive_gaps_patch(
  'public.public_quote_drawings(uuid)',
  'WHERE q.public_token = p_token AND d.include_in_client_pdf',
  'WHERE q.public_token = p_token AND q.archived_at IS NULL /*archive-gaps*/ AND d.include_in_client_pdf'
);

SELECT public._archive_gaps_patch(
  'public.public_quote_show_unit_cards(uuid)',
  'WHERE q.public_token = p_token',
  'WHERE q.public_token = p_token AND q.archived_at IS NULL /*archive-gaps*/'
);

SELECT public._archive_gaps_patch(
  'public.get_customer_invoices_public(uuid)',
  'and coalesce(i.status,'''') not in (''void'',''cancelled'',''draft'')',
  'and i.archived_at IS NULL /*archive-gaps*/ and coalesce(i.status,'''') not in (''void'',''cancelled'',''canceled'',''draft'')'
);

SELECT public._archive_gaps_patch(
  'public.get_customer_portal_data(uuid)',
  'WHERE inv.customer_id = v_cid AND inv.status NOT IN (''cancelled'',''void'')',
  'WHERE inv.customer_id = v_cid AND inv.archived_at IS NULL /*archive-gaps*/ AND inv.status NOT IN (''cancelled'',''void'',''canceled'')'
);

DROP FUNCTION public._archive_gaps_patch(text, text, text);
