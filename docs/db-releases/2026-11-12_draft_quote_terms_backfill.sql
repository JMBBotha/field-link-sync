-- ONE-OFF. Not a migration. Do not run until Johan asks.
-- Fills empty terms_text on DRAFT quotes of the master company (Massair CT) only,
-- using the imported wording stored by 20261112113000_quote_standard_terms.sql.
-- Leaves drafts that already have wording, including Q-2026-0056 and the other
-- imported copies. Does not update sent, viewed, accepted, declined or archived quotes.
-- Does not touch invoices or any other company.

UPDATE public.quotes q
SET terms_text = public.fl_standard_terms_for_company(q.company_id)
WHERE q.company_id = public.fl_master_company_id()
  AND q.status::text = 'draft'
  AND q.archived_at IS NULL
  AND (q.terms_text IS NULL OR btrim(q.terms_text) = '');
