-- Preview only. Do not apply this to the live database from the pull request.
-- Massair CT and Massair Ind short profile terms still say one year / five years.
-- The long terms (section 5) are two years on moving parts, 3 years on the compressor,
-- and the service contract extends the compressor to 5 years. Only that warranty
-- sentence changes. Banking details and terms of payment stay as they are.
--
-- Old text, for rollback (both profiles):
-- WARRANTY: One year on all moving parts, and a five year manufacturer's warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer's warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.
--
-- Restore with the reverse replace() on the same ids.

UPDATE public.company_profiles
SET terms_text = replace(
  terms_text,
  'One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.',
  'Two years warranty on all moving parts and a 3-year manufacturer''s warranty on the compressor, subject to a service contract. Our service contract extends the manufacturer''s warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge.'
)
WHERE id IN (
  '8ebd6434-3fca-5a8d-8476-270e994dcb46', -- Massair CT (Pty) Ltd
  'e4030429-0f61-5c0c-8bd2-f20b0ea162ef'  -- MASSAIR IND CC
)
AND terms_text LIKE '%One year on all moving parts, and a five year manufacturer''s warranty%';
