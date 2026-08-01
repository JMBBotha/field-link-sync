UPDATE public.leads t
SET notes = concat_ws(E'\n', t.notes, '--- Merged superseded 12 Aug enquiry ---', d.notes)
FROM public.leads d
WHERE t.id = '1167ee0c-d95c-44f2-a4bf-8ee911079328'
  AND d.id = '4b794c0f-fd80-4b8c-859d-23d805bfb2a0';

UPDATE public.jobs SET lead_id = '1167ee0c-d95c-44f2-a4bf-8ee911079328'
WHERE lead_id = '4b794c0f-fd80-4b8c-859d-23d805bfb2a0';

UPDATE public.vapi_calls SET lead_id = '1167ee0c-d95c-44f2-a4bf-8ee911079328'
WHERE lead_id = '4b794c0f-fd80-4b8c-859d-23d805bfb2a0';

DELETE FROM public.leads WHERE id = '4b794c0f-fd80-4b8c-859d-23d805bfb2a0';