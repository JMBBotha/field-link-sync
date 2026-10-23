-- Restores the 0027 bodies of quote_archive / quote_unarchive (which fail against live audit_log_action_check).

CREATE OR REPLACE FUNCTION public.quote_archive(p_quote uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes; v_read int;
BEGIN
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason for archiving this quote'; END IF;
  q := public._quote_admin_row(p_quote);
  IF q.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Quote % is already archived', coalesce(q.quote_number, ''); END IF;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('quotes', q.id, 'archive', public._quote_snapshot(q.id), jsonb_build_object('reason', btrim(p_reason)), auth.uid(), q.company_id);
  UPDATE public.quotes SET archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason) WHERE id = q.id;
  -- Off the bell: unread alerts about this quote are marked read (kept, not deleted).
  UPDATE public.notifications n SET read = true
   WHERE NOT coalesce(n.read, false) AND (n.related_id = q.id OR n.metadata->>'quote_id' = q.id::text);
  GET DIAGNOSTICS v_read = ROW_COUNT;
  RETURN jsonb_build_object('archived', true, 'quote_id', q.id, 'quote_number', q.quote_number, 'notifications_marked_read', v_read);
END $function$;

CREATE OR REPLACE FUNCTION public.quote_unarchive(p_quote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes;
BEGIN
  q := public._quote_admin_row(p_quote);
  IF q.archived_at IS NULL THEN RAISE EXCEPTION 'Quote % is not archived', coalesce(q.quote_number, ''); END IF;
  UPDATE public.quotes SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = q.id;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('quotes', q.id, 'unarchive', jsonb_build_object('archived_at', q.archived_at, 'archived_by', q.archived_by, 'archive_reason', q.archive_reason),
          NULL, auth.uid(), q.company_id);
  RETURN jsonb_build_object('archived', false, 'quote_id', q.id, 'quote_number', q.quote_number);
END $function$;
