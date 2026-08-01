-- Merge the duplicate lead's notes into the real booked lead, then remove it
UPDATE public.leads target
SET notes = concat_ws(E'\n', target.notes, '--- Merged from duplicate call lead ---', dup.notes)
FROM public.leads dup
WHERE target.id = '1167ee0c-d95c-44f2-a4bf-8ee911079328'
  AND dup.id = '116febc0-0e25-47da-bb36-f9f5caa6e723';

UPDATE public.jobs SET lead_id = '1167ee0c-d95c-44f2-a4bf-8ee911079328'
WHERE lead_id = '116febc0-0e25-47da-bb36-f9f5caa6e723';

DELETE FROM public.leads WHERE id = '116febc0-0e25-47da-bb36-f9f5caa6e723';

-- Back-fill the call that failed to log (duration came through as 87.439)
INSERT INTO public.vapi_calls (
  provider, provider_call_id, direction, company_id, customer_id, lead_id,
  caller_phone, caller_name, started_at, ended_at, duration_seconds,
  service_type, outcome, summary, created_at
)
SELECT 'vapi', 'recovered-2026-08-01-1418', 'inbound',
       'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd',
       'c786e758-8372-472c-ad19-5925dc274bdc',
       '1167ee0c-d95c-44f2-a4bf-8ee911079328',
       '+27696838624', 'Johan Botha',
       timestamptz '2026-08-01 14:17:16+00', timestamptz '2026-08-01 14:18:50+00', 87,
       'New Quote', 'lead_enriched',
       'Rescheduled the new-installation quote appointment to 14 August at 12:00 (call log recovered after a logging failure).',
       timestamptz '2026-08-01 14:18:50+00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.vapi_calls WHERE provider_call_id = 'recovered-2026-08-01-1418'
);

-- Remove the self-test row so the Calls tab only shows real calls
DELETE FROM public.vapi_calls WHERE provider_call_id = '__selftest__';

-- Keep the single job aligned with the latest rescheduled slot (14 Aug 12:00 SAST)
UPDATE public.jobs
SET scheduled_for = timestamptz '2026-08-14 12:00:00+02',
    lead_id = '1167ee0c-d95c-44f2-a4bf-8ee911079328'
WHERE id = '7bedb1bc-ba3e-4f3f-8e87-d0bd4515f73f';