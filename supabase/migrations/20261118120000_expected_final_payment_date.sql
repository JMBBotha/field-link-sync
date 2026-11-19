-- Expected final payment date on an invoice (Johan 18 Nov 2026).
-- Null means Home shows the invoice issue date. Existing invoice rows are not updated.
-- Amounts, numbering and PDFs are unchanged. Apply this file when you are ready;
-- this change does not run it against the live database.
-- Existing RLS and enforce_company_writable() still decide who may update the row.

alter table public.invoices
  add column if not exists expected_final_payment_date date;

comment on column public.invoices.expected_final_payment_date is
  'Hand-set date the final balance is expected. Null uses the invoice issue date on Home. Does not change amounts, numbering, or the PDF.';
