DELETE FROM public.vapi_calls a USING public.vapi_calls b
WHERE a.provider_call_id IS NOT NULL
  AND a.provider_call_id = b.provider_call_id
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS vapi_calls_provider_call_id_key
  ON public.vapi_calls (provider_call_id)
  WHERE provider_call_id IS NOT NULL;