-- ONE-OFF. Not a migration. Do not run until Johan asks.
-- Fills empty terms_text on DRAFT quotes only, using the company standard
-- (fl_standard_terms_for_company from 20261112113000_quote_standard_terms.sql).
-- Leaves any draft that already has wording (imported Massair CT terms, including
-- the SQL drafts Q-2026-0058 to Q-2026-0061).
-- Does not update sent, viewed, accepted, declined or archived quotes.
-- Does not touch invoices.

UPDATE public.quotes q
SET terms_text = public.fl_standard_terms_for_company(q.company_id)
WHERE q.status::text = 'draft'
  AND q.archived_at IS NULL
  AND (q.terms_text IS NULL OR btrim(q.terms_text) = '');
