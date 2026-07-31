CREATE TABLE public.vapi_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'vapi',
  provider_call_id TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  caller_phone TEXT,
  caller_name TEXT,
  business_phone TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  ended_reason TEXT,
  service_type TEXT,
  urgency TEXT,
  summary TEXT,
  transcript TEXT,
  recording_url TEXT,
  outcome TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vapi_calls_provider_call_id_key ON public.vapi_calls (provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE INDEX vapi_calls_customer_id_idx ON public.vapi_calls (customer_id);
CREATE INDEX vapi_calls_lead_id_idx ON public.vapi_calls (lead_id);
CREATE INDEX vapi_calls_company_created_idx ON public.vapi_calls (company_id, created_at DESC);
CREATE INDEX vapi_calls_caller_phone_idx ON public.vapi_calls (caller_phone);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vapi_calls TO authenticated;
GRANT ALL ON public.vapi_calls TO service_role;

ALTER TABLE public.vapi_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can view their calls"
ON public.vapi_calls FOR SELECT TO authenticated
USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Company members can insert their calls"
ON public.vapi_calls FOR INSERT TO authenticated
WITH CHECK (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Company members can update their calls"
ON public.vapi_calls FOR UPDATE TO authenticated
USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Company members can delete their calls"
ON public.vapi_calls FOR DELETE TO authenticated
USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE TRIGGER update_vapi_calls_updated_at
BEFORE UPDATE ON public.vapi_calls
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();