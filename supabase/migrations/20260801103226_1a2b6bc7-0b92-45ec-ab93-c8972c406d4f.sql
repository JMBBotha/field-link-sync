DROP INDEX IF EXISTS public.vapi_calls_provider_call_id_key;
CREATE UNIQUE INDEX vapi_calls_provider_call_id_key ON public.vapi_calls (provider_call_id);