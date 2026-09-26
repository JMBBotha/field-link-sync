CREATE OR REPLACE FUNCTION public.request_call_report(p_call_id uuid, p_test boolean DEFAULT false, p_force boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token uuid; v_id bigint;
BEGIN
  SELECT call_report_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/call-report',
    headers := jsonb_build_object('Content-Type','application/json','x-call-report-token', v_token::text),
    body := jsonb_build_object('call_id', p_call_id, 'test', p_test, 'force', p_force),
    timeout_milliseconds := 60000
  ) INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.request_call_report(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_call_report(uuid, boolean, boolean) TO service_role;