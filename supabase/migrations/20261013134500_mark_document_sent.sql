-- Mark as sent (without emailing) for quotes and invoices (Johan 2026-10-13 13:45). Additive only.
ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS sent_method text, ADD COLUMN IF NOT EXISTS sent_channel text, ADD COLUMN IF NOT EXISTS sent_note text, ADD COLUMN IF NOT EXISTS sent_by uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS sent_method text, ADD COLUMN IF NOT EXISTS sent_channel text, ADD COLUMN IF NOT EXISTS sent_note text, ADD COLUMN IF NOT EXISTS sent_by uuid;

CREATE OR REPLACE FUNCTION public.mark_document_sent(p_kind text, p_id uuid, p_channel text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_my_co uuid := public.get_user_company_id(auth.uid());
  v_co uuid; v_status text; v_num text; v_cust text; v_mine boolean; v_total numeric;
  v_admin boolean; v_office boolean; v_rep boolean; v_owner boolean; v_name text;
  v_ch text := lower(coalesce(nullif(trim(p_channel), ''), 'other'));
  v_label text; v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF v_ch NOT IN ('whatsapp', 'handed_over', 'other') THEN RAISE EXCEPTION 'Unknown method'; END IF;
  v_label := CASE v_ch WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'handed_over' THEN 'Handed over' ELSE 'Other' END;

  IF p_kind = 'quote' THEN
    SELECT company_id, status, quote_number, customer_name, total, (v_uid IN (created_by, owner_id, sales_engineer_id))
      INTO v_co, v_status, v_num, v_cust, v_total, v_mine FROM quotes WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'invoice' THEN
    SELECT company_id, status, invoice_number, customer_name, grand_total, (agent_id = v_uid)
      INTO v_co, v_status, v_num, v_cust, v_total, v_mine FROM invoices WHERE id = p_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'Unknown document type'; END IF;

  IF v_co IS NULL OR v_co IS DISTINCT FROM v_my_co THEN RAISE EXCEPTION 'Document not found'; END IF;

  v_owner  := coalesce(public.is_company_owner(v_uid, v_co), false);
  v_admin  := public.has_role(v_uid, 'admin') OR EXISTS (SELECT 1 FROM company_members WHERE user_id = v_uid AND company_id = v_co AND role = 'admin');
  v_rep    := public.is_sales_rep(v_uid);
  v_office := public.has_role(v_uid, 'dispatcher') AND NOT v_rep;
  IF NOT (v_owner OR v_admin OR v_office OR (v_rep AND coalesce(v_mine, false))) THEN
    RAISE EXCEPTION 'You are not allowed to mark this document as sent';
  END IF;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only a draft can be marked as sent (now %)', v_status; END IF;

  IF p_kind = 'quote' THEN
    UPDATE quotes SET status = 'sent', sent_at = now(), sent_method = 'manual', sent_channel = v_ch, sent_note = v_note, sent_by = v_uid,
      public_token = coalesce(public_token, gen_random_uuid()), updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE invoices SET status = 'sent', sent_at = now(), sent_method = 'manual', sent_channel = v_ch, sent_note = v_note, sent_by = v_uid, updated_at = now() WHERE id = p_id;
  END IF;

  INSERT INTO audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  VALUES ('marked_sent_manual', v_co, p_id, CASE p_kind WHEN 'quote' THEN 'quotes' ELSE 'invoices' END, v_uid,
          jsonb_build_object('status', v_status),
          jsonb_build_object('status', 'sent', 'sent_method', 'manual', 'channel', v_ch, 'note', v_note));

  IF NOT v_owner THEN
    SELECT coalesce(full_name, 'Someone') INTO v_name FROM profiles WHERE id = v_uid;
    INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
    SELECT cm.user_id, p_kind || '_marked_sent',
           initcap(p_kind) || ' ' || coalesce(v_num, '') || ' marked as sent · ' || v_label,
           coalesce(v_name, 'Someone') || ' marked ' || p_kind || ' ' || coalesce(v_num, '') || coalesce(' for ' || v_cust, '') ||
             ' as sent (not emailed) via ' || v_label || coalesce('. Note: ' || v_note, ''),
           p_id, jsonb_build_object('by', v_uid, 'channel', v_ch, 'kind', p_kind, 'total', v_total)
    FROM company_members cm WHERE cm.company_id = v_co AND cm.role = 'admin' AND cm.is_owner AND cm.user_id <> v_uid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 'sent', 'channel', v_ch);
END $$;
REVOKE ALL ON FUNCTION public.mark_document_sent(text, uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_document_sent(text, uuid, text, text) TO authenticated;
