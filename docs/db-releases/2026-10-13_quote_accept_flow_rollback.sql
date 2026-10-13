-- Rollback for 2026-10-13_quote_accept_flow.sql
DROP TRIGGER IF EXISTS trg_qa_resolve_change_requests ON public.quotes;
DROP FUNCTION IF EXISTS public.qa_resolve_change_requests();
DROP FUNCTION IF EXISTS public.public_quote_change_state(uuid);
DROP FUNCTION IF EXISTS public.request_quote_changes(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_quote_id uuid;
BEGIN
  SELECT id INTO v_quote_id
  FROM public.quotes
  WHERE public_token = p_token
  AND status IN ('sent', 'viewed', 'draft');

  IF v_quote_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.quotes
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by = p_accepted_by,
      accepted_signature = p_signature
  WHERE id = v_quote_id;

  -- Deposit invoice must exist immediately after acceptance.
  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);

  RETURN true;
END;
$function$;
DROP FUNCTION IF EXISTS public.qa_notify_rep_and_admins(uuid, text, text, text);
-- Keeps any client messages: rename instead of drop. Drop manually once read.
ALTER TABLE IF EXISTS public.quote_change_requests RENAME TO quote_change_requests_rolledback;
