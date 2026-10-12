-- Undo the 12 Oct one-off merge (restores status + clears merge fields; see backup-botha-leads-*.json)
BEGIN;
UPDATE public.leads SET status='pending', merged_into_id=NULL, cancellation_reason=NULL,
  merge_history = merge_history - (jsonb_array_length(merge_history)-1)
 WHERE id IN ('edd58d95-ded4-4283-ae48-7c609ed617f0','7258afef-cb77-4707-a9c9-1c14ea08e055') AND merged_into_id='66c17a64-72b0-44cc-8a5b-f335ff097397';
UPDATE public.leads SET merge_history = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(merge_history) e WHERE e->>'action'<>'absorbed'),'[]'::jsonb)
 WHERE id='66c17a64-72b0-44cc-8a5b-f335ff097397';
COMMIT;
