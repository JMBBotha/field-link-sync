-- NOT APPLIED. Do not run this against the live database from the pull request.
--
-- Saving Massair CT's company profile failed with:
--   42501 This company is not active. UPDATE on company_profiles is not allowed
-- from enforce_company_writable(). CT is fl_master_company_id(), so the AFTER
-- trigger fl_profiles_after() ran
--   update public.company_profiles set updated_at = updated_at
--   where company_id is distinct from NEW.company_id
-- and that statement also touched archived Massair Ind CC. The writable check
-- rejected Ind and rolled the CT change back. Johan could not save any CT
-- profile edit.
--
-- This replaces only fl_profiles_after(). enforce_company_writable() is unchanged
-- and no trigger is disabled. Propagation still bumps every other profile whose
-- company would pass that check (company_id is null, or is_company_writable).
-- Archived and otherwise inactive companies are left out of the UPDATE, so the
-- check never sees them and cannot roll the master save back.
--
-- Previous function:
--   if NEW.company_id = public.fl_master_company_id() then
--     update public.company_profiles
--        set updated_at = updated_at
--      where company_id is distinct from NEW.company_id;
--   end if;
--
-- After the function is in place, replace only Massair CT's one-year warranty
-- sentence. Ind CC is not in the WHERE clause.
--
-- Old CT sentence, for rollback (reverse replace on the same id):
-- One year on all moving parts, and a five year manufacturer's warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer's warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.

CREATE OR REPLACE FUNCTION public.fl_profiles_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.company_id = public.fl_master_company_id() THEN
    UPDATE public.company_profiles AS p
       SET updated_at = p.updated_at
     WHERE p.company_id IS DISTINCT FROM NEW.company_id
       AND (p.company_id IS NULL OR public.is_company_writable(p.company_id));
  END IF;
  RETURN NULL;
END;
$$;

UPDATE public.company_profiles
SET terms_text = replace(
  terms_text,
  'One year on all moving parts, and a five year manufacturer''s warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer''s warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.',
  'Two years warranty on all moving parts and a 3-year manufacturer''s warranty on the compressor, subject to a service contract. Our service contract extends the manufacturer''s warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge.'
)
WHERE id = '8ebd6434-3fca-5a8d-8476-270e994dcb46'
  AND terms_text LIKE '%One year on all moving parts, and a five year manufacturer''s warranty%';
