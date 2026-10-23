-- 0027: Admin "Delete quote" / "Archive quote" (Massair CT). Scope: delete-quote-scope.md (23 Oct 2026).
-- Adds quotes.archived_at/by/reason, the four admin RPCs, and hides archived quotes from the follow-up / nudge crons.
-- Idempotent. Rollback: drizzle/rollback/0027_quote_delete_archive_rollback.sql

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS archive_reason text;
CREATE INDEX IF NOT EXISTS idx_quotes_company_not_archived ON public.quotes (company_id, created_at DESC) WHERE archived_at IS NULL;

-- Shared guard: caller must be an admin of the quote's own company. Returns the quote row (locked).
CREATE OR REPLACE FUNCTION public._quote_admin_row(p_quote uuid)
 RETURNS public.quotes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can delete or archive quotes' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO q FROM public.quotes WHERE id = p_quote FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found' USING ERRCODE = 'P0002'; END IF;
  IF q.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not allowed: this quote belongs to another company' USING ERRCODE = '42501';
  END IF;
  RETURN q;
END $function$;

-- What a hard delete would remove, and why it may only be archived. Read-only.
CREATE OR REPLACE FUNCTION public._quote_delete_facts(p_quote uuid, p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r text[] := '{}'; v_draft uuid[]; c jsonb; v_inv_list text; v_photos int := 0; v_other_quotes int := 0;
BEGIN
  -- Draft invoices that were never sent are cleaned up with the quote; anything else blocks.
  SELECT coalesce(array_agg(i.id), '{}') INTO v_draft FROM public.invoices i
   WHERE i.quote_id = p_quote AND i.status = 'draft' AND i.sent_at IS NULL;
  SELECT string_agg(coalesce(i.invoice_number, 'invoice') || ' (' || coalesce(i.status, '?') || ')', ', ') INTO v_inv_list
    FROM public.invoices i WHERE i.quote_id = p_quote AND NOT (i.id = ANY (v_draft));
  IF v_inv_list IS NOT NULL THEN r := r || ('Has invoice ' || v_inv_list); END IF;
  IF EXISTS (SELECT 1 FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id WHERE i.quote_id = p_quote) THEN
    r := r || 'Has a payment'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.company_invoices ci WHERE ci.quote_id = p_quote) THEN r := r || 'Has a company invoice'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.credit_notes cn WHERE cn.invoice_id = ANY (v_draft)) THEN r := r || 'Has a credit note'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.quote_id = p_quote OR j.variation_quote_id = p_quote) THEN r := r || 'Has a job'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.proposals pr WHERE pr.quote_id = p_quote) THEN r := r || 'Has a proposal'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.sales_commission_snapshots s WHERE s.quote_id = p_quote) THEN r := r || 'Has a commission record'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.tech_earnings_ledger t WHERE t.quote_id = p_quote) THEN r := r || 'Has technician earnings'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_requests x WHERE x.quote_id = p_quote) THEN r := r || 'Has an invoice request'::text; END IF;
  IF EXISTS (SELECT 1 FROM public.shop_orders x WHERE x.quote_id = p_quote) THEN r := r || 'Has a shop order'::text; END IF;

  IF p_lead IS NOT NULL THEN
    SELECT count(*) INTO v_other_quotes FROM public.quotes WHERE lead_id = p_lead AND id <> p_quote;
    IF v_other_quotes = 0 THEN SELECT count(*) INTO v_photos FROM public.job_photos WHERE lead_id = p_lead; END IF;
  END IF;

  c := jsonb_build_object(
    'items', (SELECT count(*) FROM public.quote_items WHERE quote_id = p_quote),
    'line_items', (SELECT count(*) FROM public.quote_line_items WHERE quote_id = p_quote),
    'areas', (SELECT count(*) FROM public.quote_areas WHERE quote_id = p_quote),
    'versions', (SELECT count(*) FROM public.quote_versions WHERE quote_id = p_quote),
    'attachments', (SELECT count(*) FROM public.quote_attachments WHERE quote_id = p_quote),
    'documents', (SELECT count(*) FROM public.quote_documents WHERE quote_id = p_quote),
    'followups', (SELECT count(*) FROM public.quote_followups WHERE quote_id = p_quote),
    'email_sends', (SELECT count(*) FROM public.quote_email_sends WHERE quote_id = p_quote),
    'change_requests', (SELECT count(*) FROM public.quote_change_requests WHERE quote_id = p_quote),
    'notifications', (SELECT count(*) FROM public.notifications n
                       WHERE n.related_id = p_quote OR n.related_id = ANY (v_draft) OR n.metadata->>'quote_id' = p_quote::text),
    'draft_invoices', coalesce(array_length(v_draft, 1), 0),
    'send_approvals', (SELECT count(*) FROM public.invoice_send_approvals a WHERE a.quote_id = p_quote OR a.invoice_id = ANY (v_draft)),
    'visit_photos', v_photos);
  RETURN jsonb_build_object('can_delete', coalesce(array_length(r, 1), 0) = 0, 'reasons', to_jsonb(r), 'counts', c,
                            'draft_invoice_ids', to_jsonb(v_draft), 'photos_optional', v_photos > 0);
END $function$;

CREATE OR REPLACE FUNCTION public.quote_delete_check(p_quote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes; f jsonb;
BEGIN
  q := public._quote_admin_row(p_quote);
  f := public._quote_delete_facts(q.id, q.lead_id);
  RETURN (f - 'draft_invoice_ids') || jsonb_build_object('quote_id', q.id, 'quote_number', q.quote_number, 'status', q.status,
    'archived', q.archived_at IS NOT NULL, 'archived_at', q.archived_at, 'archive_reason', q.archive_reason);
END $function$;

CREATE OR REPLACE FUNCTION public._quote_snapshot(p_quote uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'quote', (SELECT to_jsonb(q) FROM public.quotes q WHERE q.id = p_quote),
    'areas', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.quote_areas a WHERE a.quote_id = p_quote), '[]'),
    'items', coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM public.quote_items i WHERE i.quote_id = p_quote), '[]'),
    'line_items', coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.quote_line_items l WHERE l.quote_id = p_quote), '[]'))
$function$;

-- Hard delete (only when quote_delete_check says can_delete). Returns storage paths to remove after commit.
CREATE OR REPLACE FUNCTION public.quote_delete(p_quote uuid, p_reason text, p_delete_photos boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q public.quotes; f jsonb; v_draft uuid[]; snap jsonb; v_notif int; v_photos int := 0;
  v_qphotos text[]; v_qdocs text[]; v_jphotos text[] := '{}';
BEGIN
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason for deleting this quote'; END IF;
  q := public._quote_admin_row(p_quote);
  f := public._quote_delete_facts(q.id, q.lead_id);
  IF NOT (f->>'can_delete')::boolean THEN
    RAISE EXCEPTION 'This quote cannot be deleted (%). Archive it instead.',
      (SELECT string_agg(x, '; ') FROM jsonb_array_elements_text(f->'reasons') x) USING ERRCODE = '55000';
  END IF;
  SELECT coalesce(array_agg(x::uuid), '{}') INTO v_draft FROM jsonb_array_elements_text(f->'draft_invoice_ids') x;
  snap := public._quote_snapshot(q.id);
  PERFORM set_config('app.quote_lock_bypass', 'on', true);

  SELECT coalesce(array_agg(storage_path), '{}') INTO v_qphotos FROM public.quote_attachments WHERE quote_id = q.id AND storage_path IS NOT NULL;
  SELECT coalesce(array_agg(storage_path), '{}') INTO v_qdocs FROM public.quote_documents WHERE quote_id = q.id AND storage_path IS NOT NULL;

  DELETE FROM public.notifications n WHERE n.related_id = q.id OR n.related_id = ANY (v_draft) OR n.metadata->>'quote_id' = q.id::text;
  GET DIAGNOSTICS v_notif = ROW_COUNT;
  DELETE FROM public.invoice_send_events e WHERE e.invoice_id = ANY (v_draft)
     OR e.approval_id IN (SELECT a.id FROM public.invoice_send_approvals a WHERE a.quote_id = q.id);
  DELETE FROM public.invoice_send_approvals a WHERE a.quote_id = q.id OR a.invoice_id = ANY (v_draft);
  DELETE FROM public.job_schedules s WHERE s.job_id IN (SELECT j.id FROM public.jobs j WHERE j.quote_id = q.id);
  DELETE FROM public.invoices i WHERE i.id = ANY (v_draft);
  UPDATE public.quote_bundles b SET quote_ids = array_remove(b.quote_ids, q.id) WHERE q.id = ANY (b.quote_ids);

  IF p_delete_photos AND (f->>'photos_optional')::boolean THEN
    SELECT coalesce(array_agg(x), '{}') INTO v_jphotos FROM (
      SELECT storage_path x FROM public.job_photos WHERE lead_id = q.lead_id AND storage_path IS NOT NULL
      UNION ALL SELECT annotated_path FROM public.job_photos WHERE lead_id = q.lead_id AND annotated_path IS NOT NULL) s;
    DELETE FROM public.job_photos WHERE lead_id = q.lead_id;
    GET DIAGNOSTICS v_photos = ROW_COUNT;
  END IF;

  DELETE FROM public.quotes WHERE id = q.id AND company_id = q.company_id;

  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('quotes', q.id, 'delete', snap,
          jsonb_build_object('reason', btrim(p_reason), 'via', 'quote_delete', 'counts', f->'counts',
                             'notifications_deleted', v_notif, 'draft_invoices_deleted', coalesce(array_length(v_draft, 1), 0),
                             'visit_photos_deleted', v_photos),
          auth.uid(), q.company_id);

  RETURN jsonb_build_object('deleted', true, 'quote_id', q.id, 'quote_number', q.quote_number,
    'notifications_deleted', v_notif, 'draft_invoices_deleted', coalesce(array_length(v_draft, 1), 0), 'visit_photos_deleted', v_photos,
    'storage', jsonb_build_object('quote-photos', to_jsonb(v_qphotos), 'quote-documents', to_jsonb(v_qdocs), 'job-photos', to_jsonb(v_jphotos)));
END $function$;

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

REVOKE ALL ON FUNCTION public._quote_admin_row(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quote_delete_facts(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._quote_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_delete_check(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_delete(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_archive(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_unarchive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_delete_check(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_delete(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_archive(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_unarchive(uuid) TO authenticated;

-- Archived quotes leave the follow-up / nudge crons and the follow-up count (live bodies, one filter added each).
CREATE OR REPLACE FUNCTION public.process_quote_followups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  for r in select q.id, q.company_id, coalesce(q.customer_name,q.quote_number,'Quote') n, q.sales_engineer_id, q.followup_state, q.followup_count, q.followup_kind
    from public.quotes q where q.archived_at is null and q.followup_state in ('quoted','followed_up','viable','close_due') and q.status not in ('accepted','declined','superseded','void')
      and (q.followup_state = 'close_due' or q.followup_next_at <= now()) loop
    if r.followup_state = 'close_due' then
      perform public._hb_nudge(r.company_id,'quote',r.id,'followup',9, array_remove(array[r.sales_engineer_id],null) || public._hb_admins(r.company_id), 'Close this quote?', r.n||': two follow-ups done, not locked in. Close it (can be reopened later).');
    else
      perform public._hb_nudge(r.company_id,'quote',r.id,'followup',r.followup_count+1, array_remove(array[r.sales_engineer_id],null) || public._hb_sales(r.company_id), 'Quote follow-up call',
        r.n||case when r.followup_kind='visit' then ': friendly follow-up '||(r.followup_count+1)||' of 2' when r.followup_state='viable' then ': call again (last call)' else ': follow-up call' end);
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.quotes_followup_due_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.quotes q
  where q.archived_at is null and q.followup_state is not null and q.followup_state <> 'closed' and q.followup_next_at is not null
    and q.followup_next_at < (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '2 day') at time zone 'Africa/Johannesburg' $function$;

CREATE OR REPLACE FUNCTION public.process_sales_escalations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_now timestamptz := now(); v_local timestamp := (now() at time zone 'Africa/Johannesburg');
  v_open boolean := extract(isodow from v_local) between 1 and 5 and v_local::time between '08:00' and '17:00';
  m numeric;
begin
  -- New lead, not contacted, not acknowledged (business hours only): 5 min rep, 15 min all sales + admin, 30 min owner/admin
  if v_open then
  for r in select l.id, l.company_id, l.customer_name, l.assigned_agent_id, extract(epoch from v_now - l.created_at)/60 as mins
    from public.leads l where l.status = 'pending' and l.first_contact_at is null and l.acknowledged_at is null
      and l.deleted_at is null and l.dismissed_at is null and l.closed_at is null and l.merged_into_id is null and l.primary_intent is distinct from 'service'
      and l.created_at > v_now - interval '3 days' loop
    if r.mins >= public._hb_limit(r.company_id,'leadRepMin',5) then
      perform public._hb_nudge(r.company_id,'lead',r.id,'new',1, array[r.assigned_agent_id] || public._hb_sales(r.company_id), 'Hot lead waiting', coalesce(r.customer_name,'New lead')||' not contacted yet'); end if;
    if r.mins >= public._hb_limit(r.company_id,'leadTeamMin',15) then
      perform public._hb_nudge(r.company_id,'lead',r.id,'new',2, public._hb_sales(r.company_id) || public._hb_admins(r.company_id), 'Hot lead overdue', coalesce(r.customer_name,'New lead')||' waiting '||round(r.mins)||' min'); end if;
    if r.mins >= public._hb_limit(r.company_id,'leadOwnerMin',30) then
      perform public._hb_nudge(r.company_id,'lead',r.id,'new',3, public._hb_admins(r.company_id), 'Hot lead: 30 min, nobody responded', coalesce(r.customer_name,'New lead')||' still waiting'); end if;
  end loop;
  end if;
  -- Contacted, no visit booked, no quote
  for r in select l.id, l.company_id, l.customer_name, l.assigned_agent_id, extract(epoch from v_now - l.first_contact_at)/86400 as d
    from public.leads l where l.status = 'pending' and l.first_contact_at is not null and l.visit_booked_at is null
      and l.deleted_at is null and l.dismissed_at is null and l.closed_at is null and l.merged_into_id is null and l.primary_intent is distinct from 'service'
      and not exists (select 1 from public.quotes q where q.lead_id = l.id) and l.first_contact_at > v_now - interval '30 days' loop
    if r.d >= public._hb_limit(r.company_id,'contactedDays',1) then perform public._hb_nudge(r.company_id,'lead',r.id,'contacted',1, array[r.assigned_agent_id], 'Book the visit', coalesce(r.customer_name,'Lead')||' contacted, no visit booked'); end if;
    if r.d >= public._hb_limit(r.company_id,'contactedAdminDays',2) then perform public._hb_nudge(r.company_id,'lead',r.id,'contacted',2, public._hb_admins(r.company_id), 'Lead stalled', coalesce(r.customer_name,'Lead')||' contacted '||floor(r.d)||' d ago, no visit'); end if;
  end loop;
  -- Quotes
  for r in select q.id, q.company_id, coalesce(q.customer_name, q.quote_number, 'Quote') as n, q.sales_engineer_id, q.status, q.sent_at, q.viewed_at, q.accepted_at,
      exists (select 1 from public.invoices i where i.quote_id = q.id and i.status in ('paid','partially_paid')) as paid,
      exists (select 1 from public.jobs j where j.quote_id = q.id and j.status not in ('cancelled')) as has_job
    from public.quotes q where q.archived_at is null and q.status in ('sent','viewed','accepted') and q.updated_at > v_now - interval '60 days' loop
    if r.status = 'sent' and r.viewed_at is null and r.sent_at < v_now - make_interval(days => public._hb_limit(r.company_id,'sentDays',2)::int) then
      perform public._hb_nudge(r.company_id,'quote',r.id,'sent',1, array[r.sales_engineer_id], 'Quote not opened', r.n||' sent, not viewed'); end if;
    if r.status = 'viewed' or (r.status = 'sent' and r.viewed_at is not null) then
      if r.viewed_at < v_now - make_interval(days => public._hb_limit(r.company_id,'viewedDays',3)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'viewed',1, array[r.sales_engineer_id], 'Follow up quote', r.n||' viewed, no answer'); end if;
      if r.viewed_at < v_now - make_interval(days => public._hb_limit(r.company_id,'viewedAdminDays',7)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'viewed',2, public._hb_admins(r.company_id), 'Quote stalled', r.n||' viewed over a week ago, no answer'); end if;
    end if;
    if r.status = 'accepted' and not r.paid and r.accepted_at is not null then
      if r.accepted_at < v_now - make_interval(days => public._hb_limit(r.company_id,'acceptedDays',2)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'accepted',1, array[r.sales_engineer_id], 'Deposit outstanding', r.n||' accepted, no deposit'); end if;
      if r.accepted_at < v_now - make_interval(days => public._hb_limit(r.company_id,'acceptedAdminDays',4)::int) then perform public._hb_nudge(r.company_id,'quote',r.id,'accepted',2, public._hb_admins(r.company_id), 'Deposit stalled', r.n||' accepted, still no deposit'); end if;
    end if;
    if r.status = 'accepted' and r.paid and not r.has_job and coalesce(r.accepted_at, v_now) < v_now - make_interval(days => public._hb_limit(r.company_id,'depositDays',1)::int) then
      perform public._hb_nudge(r.company_id,'quote',r.id,'deposit',1, public._hb_dispatch(r.company_id) || public._hb_admins(r.company_id), 'Book the install', r.n||' deposit in, no install booked'); end if;
  end loop;
  -- Install done, not paid
  for r in select j.id, j.company_id, coalesce(j.title,'Job') as n from public.jobs j
    where j.quote_id is not null and j.status = 'completed' and j.completed_at < v_now - make_interval(days => public._hb_limit(j.company_id,'doneDays',7)::int)
      and j.completed_at > v_now - interval '60 days'
      and not exists (select 1 from public.invoices i where i.quote_id = j.quote_id and i.status = 'paid' and coalesce(i.notes,'') not like 'DEPOSIT%') loop
    perform public._hb_nudge(r.company_id,'job',r.id,'done',1, public._hb_admins(r.company_id), 'Get paid', r.n||' finished, not paid in full');
  end loop;
  perform public.process_invoice_followups();
end $function$;
