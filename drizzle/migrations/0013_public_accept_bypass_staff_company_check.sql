CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_quote_id uuid; v_num text; v_cust text;
BEGIN
  SELECT id, quote_number, customer_name INTO v_quote_id, v_num, v_cust
  FROM public.quotes WHERE public_token = p_token AND status IN ('sent', 'viewed');
  IF v_quote_id IS NULL THEN RETURN false; END IF;

  UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = p_accepted_by, accepted_signature = p_signature
  WHERE id = v_quote_id;

  -- Token holder = the client. A signed-in staff session in the same browser (any company/role) must not block this.
  PERFORM set_config('app.public_quote_accept', v_quote_id::text, true);
  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);
  PERFORM set_config('app.public_quote_accept', '', true);

  PERFORM public.qa_notify_rep_and_admins(v_quote_id, 'quote_accepted_client',
    'Quote ' || COALESCE(v_num, '') || ' accepted by client',
    COALESCE(NULLIF(p_accepted_by, ''), v_cust, 'Client') || ' accepted quote ' || COALESCE(v_num, '') || ' online.');
  RETURN true;
END;
$function$;

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.create_deposit_invoice_for_quote(uuid)'::regprocedure);
  d := replace(d, 'PERFORM public.rh_assert(false); /*rh1*/',
    'IF COALESCE(current_setting(''app.public_quote_accept'', true), '''') IS DISTINCT FROM p_quote_id::text THEN PERFORM public.rh_assert(false); END IF; /*rh1*/');
  d := replace(d, 'IF auth.uid() IS NOT NULL AND COALESCE(q.company_id',
    'IF auth.uid() IS NOT NULL AND COALESCE(current_setting(''app.public_quote_accept'', true), '''') IS DISTINCT FROM p_quote_id::text AND COALESCE(q.company_id');
  EXECUTE d;
END $mig$;