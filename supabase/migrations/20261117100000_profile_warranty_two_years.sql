-- NOT APPLIED. This file no longer writes company_profiles.
--
-- The original statement updated Massair CT and Massair Ind CC in one UPDATE.
-- CT is the master company, so fl_profiles_after() then touched every other
-- profile, including archived Ind. enforce_company_writable() rejected that
-- row and the whole statement rolled back, so CT could not be saved either.
--
-- The function fix and the CT-only sentence change are in
-- 20261117123000_profile_propagate_skip_inactive.sql, which runs after this
-- version. Ind CC is not updated.
--
-- Old warranty sentence, kept here so it can be put back with a reverse replace
-- on CT profile 8ebd6434-3fca-5a8d-8476-270e994dcb46:
-- One year on all moving parts, and a five year manufacturer's warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer's warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.

DO $$
BEGIN
  -- Record this version without writing a profile. The later migration does the CT sentence.
  NULL;
END $$;
