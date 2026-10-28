-- 28 Oct 2026 (Johan t1856u): option quotes, stage log, admin Move back / Reopen. Additive.
-- Rollback: supabase/rollbacks/20261028160000_quote_options_move_back_rollback.sql
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS option_group_id uuid;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS option_label text;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS option_chosen_id uuid;
CREATE INDEX IF NOT EXISTS quotes_option_group_idx ON public.quotes(option_group_id) WHERE option_group_id IS NOT NULL;

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status = ANY (ARRAY['draft','sent','viewed','accepted','declined','option_not_chosen']));

CREATE TABLE IF NOT EXISTS public.quote_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid, quote_id uuid NOT NULL,
  from_status text, to_status text, kind text NOT NULL DEFAULT 'change', reason text,
  actor uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_stage_events_quote_idx ON public.quote_stage_events(quote_id, created_at);
ALTER TABLE public.quote_stage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qse_select_company ON public.quote_stage_events;
CREATE POLICY qse_select_company ON public.quote_stage_events FOR SELECT TO authenticated
  USING (company_id = public.get_user_company_id(auth.uid()));

-- Every status change is logged; accepting one option marks its open siblings "option not chosen".
CREATE OR REPLACE FUNCTION public.fl_quote_stage_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_kind text := coalesce(nullif(current_setting('app.quote_stage_kind', true),''), 'change');
        v_reason text := nullif(current_setting('app.quote_stage_reason', true),'');
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO quote_stage_events(company_id, quote_id, from_status, to_status, kind, reason, actor)
    VALUES (NEW.company_id, NEW.id, OLD.status, NEW.status, v_kind, v_reason, auth.uid());
    IF NEW.status = 'accepted' AND NEW.option_group_id IS NOT NULL THEN
      PERFORM set_config('app.quote_stage_kind', 'option_auto', true);
      PERFORM set_config('app.quote_stage_reason', 'Client chose ' || coalesce(NEW.quote_number, 'another option'), true);
      UPDATE quotes SET status = 'option_not_chosen', option_chosen_id = NEW.id, followup_state = CASE WHEN followup_state IS NULL THEN NULL ELSE 'closed' END, followup_next_at = NULL
       WHERE option_group_id = NEW.option_group_id AND id <> NEW.id AND status IN ('draft','sent','viewed');
      PERFORM set_config('app.quote_stage_kind', v_kind, true);
      PERFORM set_config('app.quote_stage_reason', coalesce(v_reason,''), true);
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_quote_stage_log ON public.quotes;
CREATE TRIGGER trg_quote_stage_log AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_stage_log();

-- "Quote Option_not_chosen" bell noise: skip the generic status notice for this status.
CREATE OR REPLACE FUNCTION public.notify_quote_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'option_not_chosen' THEN RETURN NEW; END IF;
    IF NEW.status = 'accepted'
       AND position(',' || NEW.id::text || ',' IN COALESCE(current_setting('app.isa_alerted_quotes', true), '')) > 0 THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (NEW.sales_engineer_id, 'quote_status_change', 'Quote ' || INITCAP(NEW.status),
            'Quote ' || NEW.quote_number || ' has been ' || NEW.status, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fl_can_manage_quotes(p_uid uuid, p_co uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.fl_quote_admin(p_uid, p_co), false)
$$;

-- Link 2-4+ quotes for one client as options of one deal. If one is already accepted, the rest become "not chosen".
CREATE OR REPLACE FUNCTION public.link_quote_options(p_quote_ids uuid[], p_labels jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid := public.get_user_company_id(auth.uid()); v_ids uuid[]; v_n int; v_cust int; v_acc int; v_gid uuid; v_win record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.fl_can_manage_quotes(auth.uid(), v_co) THEN RAISE EXCEPTION 'Only an admin can link options' USING ERRCODE='42501'; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_quote_ids) x;
  IF coalesce(array_length(v_ids,1),0) < 2 THEN RAISE EXCEPTION 'Pick at least two quotes'; END IF;
  SELECT count(*), count(DISTINCT customer_id), count(*) FILTER (WHERE status='accepted'),
         (array_agg(option_group_id) FILTER (WHERE option_group_id IS NOT NULL))[1]
    INTO v_n, v_cust, v_acc, v_gid FROM quotes WHERE id = ANY(v_ids) AND company_id = v_co;
  IF v_n <> array_length(v_ids,1) THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF v_cust <> 1 OR EXISTS (SELECT 1 FROM quotes WHERE id = ANY(v_ids) AND customer_id IS NULL) THEN RAISE EXCEPTION 'All options must be for the same client'; END IF;
  IF v_acc > 1 THEN RAISE EXCEPTION 'More than one of these quotes is accepted. Move one back first.'; END IF;
  v_gid := coalesce(v_gid, gen_random_uuid());
  UPDATE quotes q SET option_group_id = v_gid,
    option_label = CASE WHEN p_labels ? q.id::text THEN nullif(left(btrim(p_labels->>q.id::text),60),'') ELSE q.option_label END
   WHERE q.id = ANY(v_ids);
  SELECT id, quote_number INTO v_win FROM quotes WHERE option_group_id = v_gid AND status = 'accepted' LIMIT 1;
  IF v_win.id IS NOT NULL THEN
    PERFORM set_config('app.quote_stage_kind', 'option_link', true);
    PERFORM set_config('app.quote_stage_reason', 'Linked as options; client chose ' || coalesce(v_win.quote_number,''), true);
    UPDATE quotes SET status = 'option_not_chosen', option_chosen_id = v_win.id, followup_state = CASE WHEN followup_state IS NULL THEN NULL ELSE 'closed' END, followup_next_at = NULL
     WHERE option_group_id = v_gid AND id <> v_win.id AND status IN ('draft','sent','viewed');
  END IF;
  RETURN v_gid;
END $$;

CREATE OR REPLACE FUNCTION public.unlink_quote_option(p_quote_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM quotes WHERE id = p_quote_id AND company_id = public.get_user_company_id(auth.uid());
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT public.fl_can_manage_quotes(auth.uid(), q.company_id) THEN RAISE EXCEPTION 'Only an admin can unlink options' USING ERRCODE='42501'; END IF;
  IF q.status = 'option_not_chosen' THEN RAISE EXCEPTION 'Reopen it first (Move back), then unlink'; END IF;
  UPDATE quotes SET option_group_id = NULL, option_label = NULL, option_chosen_id = NULL WHERE id = p_quote_id;
  RETURN true;
END $$;

-- Admin "Move back" / "Reopen": one step back with a reason. Blocked once money or an active job exists.
CREATE OR REPLACE FUNCTION public.quote_move_back(p_quote_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q record; v_to text; v_voided int := 0; v_reopened int := 0; v_reason text := btrim(coalesce(p_reason,'')); r record;
BEGIN
  SELECT * INTO q FROM quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL OR q.company_id IS DISTINCT FROM public.get_user_company_id(auth.uid()) THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT public.fl_can_manage_quotes(auth.uid(), q.company_id) THEN RAISE EXCEPTION 'Only an admin can move a quote back' USING ERRCODE='42501'; END IF;
  IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Please give a reason'; END IF;
  IF EXISTS (SELECT 1 FROM jobs WHERE quote_id = q.id AND coalesce(status,'') NOT IN ('cancelled')) THEN
    RAISE EXCEPTION 'A job is booked for this quote. Cancel the job first.' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM invoices i WHERE i.quote_id = q.id AND (i.status IN ('paid','partially_paid')
             OR EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id))) THEN
    RAISE EXCEPTION 'A payment is recorded for this quote. Refund or credit it first.' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM invoices i WHERE i.quote_id = q.id AND i.status NOT IN ('draft','void','cancelled')) THEN
    RAISE EXCEPTION 'An invoice for this quote was already sent. Void or credit it first.' USING ERRCODE='P0001'; END IF;
  v_to := CASE WHEN q.status IN ('accepted','declined','option_not_chosen') THEN CASE WHEN q.viewed_at IS NOT NULL THEN 'viewed' WHEN q.sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END
               WHEN q.status = 'viewed' THEN 'sent' ELSE NULL END;
  IF v_to IS NULL THEN RAISE EXCEPTION 'This quote is already at the first stage'; END IF;

  PERFORM set_config('app.quote_lock_bypass', 'on', true);
  PERFORM set_config('app.quote_stage_kind', CASE WHEN q.status IN ('declined','option_not_chosen') THEN 'reopen' ELSE 'move_back' END, true);
  PERFORM set_config('app.quote_stage_reason', v_reason, true);
  IF q.status = 'accepted' THEN
    UPDATE invoice_send_approvals SET status='held', decision='hold', hold_reason='Quote moved back: ' || v_reason, decided_by=auth.uid(), decided_at=now(), due_at=NULL, updated_at=now()
     WHERE quote_id = q.id AND status = 'pending' AND sent_at IS NULL;
    FOR r IN SELECT id FROM invoices WHERE quote_id = q.id AND status = 'draft' AND sent_at IS NULL LOOP
      UPDATE invoices SET status='void', archived_at=now() WHERE id = r.id;
      UPDATE invoices SET sent_at = NULL WHERE id = r.id; -- void is not a send
      v_voided := v_voided + 1;
    END LOOP;
  END IF;
  UPDATE quotes SET status = v_to,
    accepted_at = CASE WHEN q.status='accepted' THEN NULL ELSE accepted_at END,
    accepted_by = CASE WHEN q.status='accepted' THEN NULL ELSE accepted_by END,
    declined_at = CASE WHEN q.status='declined' THEN NULL ELSE declined_at END,
    option_chosen_id = CASE WHEN q.status='option_not_chosen' THEN NULL ELSE option_chosen_id END,
    locked_at = CASE WHEN locked_reason='accepted' THEN NULL ELSE locked_at END,
    locked_by = CASE WHEN locked_reason='accepted' THEN NULL ELSE locked_by END,
    locked_reason = CASE WHEN locked_reason='accepted' THEN NULL ELSE locked_reason END
   WHERE id = q.id;
  IF q.locked_reason = 'accepted' THEN
    INSERT INTO quote_lock_events(quote_id, company_id, action, reason, actor) VALUES (q.id, q.company_id, 'unlock', 'Moved back: ' || v_reason, auth.uid());
  END IF;
  -- Undoing the chosen option reopens the siblings it had set aside.
  IF q.status = 'accepted' AND q.option_group_id IS NOT NULL THEN
    UPDATE quotes s SET status = CASE WHEN s.viewed_at IS NOT NULL THEN 'viewed' WHEN s.sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END, option_chosen_id = NULL
     WHERE s.option_group_id = q.option_group_id AND s.status = 'option_not_chosen' AND s.option_chosen_id = q.id;
    GET DIAGNOSTICS v_reopened = ROW_COUNT;
  END IF;
  PERFORM set_config('app.quote_stage_kind', '', true);
  PERFORM set_config('app.quote_stage_reason', '', true);
  RETURN jsonb_build_object('from', q.status, 'to', v_to, 'invoices_voided', v_voided, 'options_reopened', v_reopened);
END $$;

REVOKE ALL ON FUNCTION public.fl_quote_stage_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_can_manage_quotes(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_quote_options(uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_quote_option(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_move_back(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.link_quote_options(uuid[], jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.unlink_quote_option(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.quote_move_back(uuid, text) FROM anon;
