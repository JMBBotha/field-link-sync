CREATE TABLE public.call_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL UNIQUE REFERENCES public.vapi_calls(id) ON DELETE CASCADE,
  company_id uuid,
  lead_id uuid,
  customer_id uuid,
  caller_phone text,
  caller_name text,
  breakdown text,
  lead_level text CHECK (lead_level IN ('hot','warm','cold')),
  urgency text CHECK (urgency IN ('emergency','same_day','standard')),
  score int CHECK (score BETWEEN 1 AND 5),
  service_type text,
  next_action text,
  address_confirmed boolean,
  address text,
  model text,
  is_test boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  error text,
  email_to text,
  email_status text CHECK (email_status IN ('sent','failed','skipped')),
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_reports_lead_idx ON public.call_reports(lead_id);
CREATE INDEX call_reports_company_idx ON public.call_reports(company_id);
GRANT SELECT ON public.call_reports TO authenticated;
GRANT ALL ON public.call_reports TO service_role;
ALTER TABLE public.call_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members can view call reports" ON public.call_reports
FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.call_reports_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER call_reports_updated_at BEFORE UPDATE ON public.call_reports FOR EACH ROW EXECUTE FUNCTION public.call_reports_touch();

ALTER TABLE public.app_webhook_config ADD COLUMN IF NOT EXISTS call_report_token uuid DEFAULT gen_random_uuid();
UPDATE public.app_webhook_config SET call_report_token = gen_random_uuid() WHERE id = 1 AND call_report_token IS NULL;

CREATE OR REPLACE FUNCTION public.request_call_report(p_call_id uuid, p_test boolean DEFAULT false, p_force boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token uuid; v_id bigint;
BEGIN
  SELECT call_report_token INTO v_token FROM public.app_webhook_config WHERE id = 1;
  IF v_token IS NULL THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/call-report',
    headers := jsonb_build_object('Content-Type','application/json','x-call-report-token', v_token::text),
    body := jsonb_build_object('call_id', p_call_id, 'test', p_test, 'force', p_force)
  ) INTO v_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.request_call_report(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_call_report(uuid, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_vapi_call_report() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF coalesce(trim(NEW.transcript),'') <> '' AND coalesce(trim(NEW.caller_phone),'') <> ''
       AND NOT EXISTS (SELECT 1 FROM public.call_reports WHERE call_id = NEW.id AND status = 'done') THEN
      PERFORM public.request_call_report(NEW.id, false, false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_vapi_call_report failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.trg_vapi_call_report() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER vapi_call_report AFTER INSERT OR UPDATE OF transcript, caller_phone ON public.vapi_calls
FOR EACH ROW EXECUTE FUNCTION public.trg_vapi_call_report();