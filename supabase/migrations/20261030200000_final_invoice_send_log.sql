-- Final invoice send log (Johan 30 Oct 19:48). Re-runnable. No payment data touched.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS final_sent_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS final_sent_channel text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS final_sent_by uuid;

-- p_stage: 'opened' (WhatsApp/app opened, audit only) | 'confirmed' (user confirms it was sent: stamp + audit + owner notification).
-- Double-send guard: a 'confirmed' within 10 minutes of the last one returns duplicate=true and writes nothing, unless p_force.
CREATE OR REPLACE FUNCTION public.log_final_invoice_send(p_id uuid, p_channel text, p_stage text DEFAULT 'confirmed', p_note text DEFAULT NULL, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_co uuid; v_status text; v_num text; v_cust text; v_last timestamptz; v_mine boolean;
  v_admin boolean; v_office boolean; v_rep boolean; v_owner boolean; v_name text;
  v_ch text := lower(coalesce(nullif(trim(p_channel), ''), 'other'));
  v_label text; v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF v_ch NOT IN ('whatsapp', 'email', 'handed_over', 'other') THEN RAISE EXCEPTION 'Unknown method'; END IF;
  IF p_stage NOT IN ('opened', 'confirmed') THEN RAISE EXCEPTION 'Unknown stage'; END IF;
  v_label := CASE v_ch WHEN 'whatsapp' THEN 'WhatsApp' WHEN 'email' THEN 'Email' WHEN 'handed_over' THEN 'Handed over' ELSE 'Other' END;

  SELECT company_id, status, invoice_number, customer_name, final_sent_at
    INTO v_co, v_status, v_num, v_cust, v_last FROM invoices WHERE id = p_id FOR UPDATE;
  IF v_co IS NULL OR v_co IS DISTINCT FROM public.get_user_company_id(v_uid) THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  v_owner  := coalesce(public.is_company_owner(v_uid, v_co), false);
  v_admin  := public.has_role(v_uid, 'admin') OR EXISTS (SELECT 1 FROM company_members WHERE user_id = v_uid AND company_id = v_co AND role = 'admin');
  v_rep    := public.is_sales_rep(v_uid);
  v_office := public.has_role(v_uid, 'dispatcher') AND NOT v_rep;
  v_mine   := coalesce(public.rep_can_see_invoice(v_uid, p_id), false);
  IF NOT (v_owner OR v_admin OR v_office OR (v_rep AND v_mine)) THEN RAISE EXCEPTION 'You are not allowed to send this invoice'; END IF;
  IF v_status IN ('draft', 'void', 'cancelled') THEN RAISE EXCEPTION 'Invoice is %', v_status; END IF;

  IF p_stage = 'opened' THEN
    INSERT INTO audit_log (action, company_id, record_id, table_name, user_id, new_data)
    VALUES ('update', v_co, p_id, 'invoices', v_uid, jsonb_build_object('event', 'final_invoice_send_opened', 'channel', v_ch));
    RETURN jsonb_build_object('ok', true, 'stage', 'opened', 'final_sent_at', v_last);
  END IF;

  IF v_last IS NOT NULL AND v_last > now() - interval '10 minutes' AND NOT p_force THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'final_sent_at', v_last);
  END IF;

  UPDATE invoices SET final_sent_at = now(), final_sent_channel = v_ch, final_sent_by = v_uid WHERE id = p_id;
  INSERT INTO audit_log (action, company_id, record_id, table_name, user_id, old_data, new_data)
  VALUES ('update', v_co, p_id, 'invoices', v_uid, jsonb_build_object('final_sent_at', v_last),
          jsonb_build_object('event', 'final_invoice_sent', 'channel', v_ch, 'note', v_note));
  IF NOT v_owner THEN
    SELECT coalesce(full_name, 'Someone') INTO v_name FROM profiles WHERE id = v_uid;
    INSERT INTO notifications (user_id, type, title, body, related_id, metadata)
    SELECT cm.user_id, 'invoice_final_sent', 'Final invoice ' || coalesce(v_num, '') || ' sent · ' || v_label,
           coalesce(v_name, 'Someone') || ' sent final invoice ' || coalesce(v_num, '') || coalesce(' to ' || v_cust, '') || ' via ' || v_label,
           p_id, jsonb_build_object('by', v_uid, 'channel', v_ch)
    FROM company_members cm WHERE cm.company_id = v_co AND cm.role = 'admin' AND cm.is_owner AND cm.user_id <> v_uid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'final_sent_at', now(), 'channel', v_ch);
END $function$;
REVOKE ALL ON FUNCTION public.log_final_invoice_send(uuid, text, text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_final_invoice_send(uuid, text, text, text, boolean) TO authenticated;
