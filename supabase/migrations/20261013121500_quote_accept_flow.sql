-- Quote accept flow (Johan 2026-10-13 12:07). Additive only. Rollback: docs/db-releases/2026-10-13_quote_accept_flow_rollback.sql

-- C) Ask for changes
CREATE TABLE IF NOT EXISTS public.quote_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  company_id uuid,
  message text NOT NULL,
  contact_name text,
  contact_phone text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);
CREATE INDEX IF NOT EXISTS idx_qcr_quote ON public.quote_change_requests(quote_id, status);
ALTER TABLE public.quote_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qcr_select_company ON public.quote_change_requests;
CREATE POLICY qcr_select_company ON public.quote_change_requests FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id());
DROP POLICY IF EXISTS qcr_update_company ON public.quote_change_requests;
CREATE POLICY qcr_update_company ON public.quote_change_requests FOR UPDATE TO authenticated
  USING (company_id = public.caller_company_id()) WITH CHECK (company_id = public.caller_company_id());

-- Notify the rep + that company's admins (in-app notifications).
CREATE OR REPLACE FUNCTION public.qa_notify_rep_and_admins(p_quote_id uuid, p_type text, p_title text, p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q public.quotes%ROWTYPE;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT u, p_type, p_title, p_body, q.id,
         jsonb_build_object('quote_id', q.id, 'link', '/admin/estimates/' || q.id::text)
  FROM (
    SELECT q.sales_engineer_id AS u WHERE q.sales_engineer_id IS NOT NULL
    UNION
    SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.company_id = q.company_id
  ) t WHERE u IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.qa_notify_rep_and_admins(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_quote_changes(p_token uuid, p_message text, p_name text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q public.quotes%ROWTYPE; v_msg text := btrim(COALESCE(p_message, ''));
BEGIN
  IF p_token IS NULL OR length(v_msg) < 3 THEN RETURN false; END IF;
  SELECT * INTO q FROM public.quotes WHERE public_token = p_token AND status IN ('sent','viewed');
  IF q.id IS NULL THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.quote_change_requests WHERE quote_id = q.id AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'Too many requests today. Please call us.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.quote_change_requests (quote_id, company_id, message, contact_name, contact_phone)
  VALUES (q.id, q.company_id, left(v_msg, 2000), NULLIF(left(btrim(COALESCE(p_name,'')),120),''), NULLIF(left(btrim(COALESCE(p_phone,'')),40),''));
  PERFORM public.qa_notify_rep_and_admins(q.id, 'quote_changes_requested',
    'Changes requested on ' || COALESCE(q.quote_number, 'quote'),
    COALESCE(q.customer_name, 'Client') || ': ' || left(v_msg, 240));
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.request_quote_changes(uuid, text, text, text) TO anon, authenticated;

-- Public page: is there an open change request? (token-gated)
CREATE OR REPLACE FUNCTION public.public_quote_change_state(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('open', true, 'requested_at', r.created_at)
  FROM public.quote_change_requests r JOIN public.quotes q ON q.id = r.quote_id
  WHERE q.public_token = p_token AND r.status = 'open'
  ORDER BY r.created_at DESC LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.public_quote_change_state(uuid) TO anon, authenticated;

-- Re-sending or accepting/declining closes open change requests.
CREATE OR REPLACE FUNCTION public.qa_resolve_change_requests()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (NEW.sent_at IS DISTINCT FROM OLD.sent_at AND NEW.sent_at IS NOT NULL)
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('accepted','declined')) THEN
    UPDATE public.quote_change_requests SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid()
     WHERE quote_id = NEW.id AND status = 'open' AND created_at < now();
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_qa_resolve_change_requests ON public.quotes;
CREATE TRIGGER trg_qa_resolve_change_requests AFTER UPDATE OF sent_at, status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.qa_resolve_change_requests();

-- D) No accepting drafts; admins notified on accept. Deposit stays idempotent
-- (on_quote_accepted trigger + this call both hit create_deposit_invoice_for_quote, which locks and returns the existing invoice).
CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_quote_id uuid; v_num text; v_cust text;
BEGIN
  SELECT id, quote_number, customer_name INTO v_quote_id, v_num, v_cust
  FROM public.quotes
  WHERE public_token = p_token
  AND status IN ('sent', 'viewed'); /*qa1: drafts cannot be accepted*/

  IF v_quote_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.quotes
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by = p_accepted_by,
      accepted_signature = p_signature
  WHERE id = v_quote_id;

  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);

  /*qa1: admins + rep*/
  PERFORM public.qa_notify_rep_and_admins(v_quote_id, 'quote_accepted_client',
    'Quote ' || COALESCE(v_num, '') || ' accepted by client',
    COALESCE(NULLIF(p_accepted_by, ''), v_cust, 'Client') || ' accepted quote ' || COALESCE(v_num, '') || ' online.');

  RETURN true;
END;
$function$;
