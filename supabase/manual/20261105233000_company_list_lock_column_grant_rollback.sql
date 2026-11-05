-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Removes the Company Management column grant. The list query will fail again
-- until it stops selecting dormant_payments_locked.

REVOKE SELECT (dormant_payments_locked) ON public.companies FROM authenticated;
