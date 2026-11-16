-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Removes the Stellenbosch go-live coverage links only.
-- Invoice rows, payments, dates, and totals stay as they are.

DELETE FROM public.invoice_house_coverage
WHERE source_ref IN (
  'go-live:0010021:17528:full_system',
  'go-live:0010021:17529:full_system',
  'go-live:0010023:17533:labour_extraction',
  'go-live:0010023:17534:labour_extraction',
  'go-live:0010023:17535:labour_extraction',
  'go-live:0010023:17536:labour_extraction'
);
