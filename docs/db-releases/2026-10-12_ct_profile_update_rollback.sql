-- Rollback: MASSAIR CT company profile update (Johan voice 2026-10-12 16:35)
-- Restores companies 361bf031, company_profiles 8ebd6434, company_settings a70c9005 from backup_ctprofile_20261012.
begin;
update public.companies c set name=b.name, updated_at=b.updated_at from backup_ctprofile_20261012.companies b where c.id=b.id;
update public.company_profiles p set legal_name=b.legal_name, vat_number=b.vat_number, address_lines=b.address_lines, bank_name=b.bank_name,
  account_name=b.account_name, account_number=b.account_number, branch_code=b.branch_code, account_type=b.account_type, terms_text=b.terms_text, updated_at=b.updated_at
  from backup_ctprofile_20261012.company_profiles b where p.id=b.id;
update public.company_settings s set company_name=b.company_name, vat_number=b.vat_number, physical_address=b.physical_address, postal_address=b.postal_address,
  banking_details=b.banking_details, updated_at=b.updated_at from backup_ctprofile_20261012.company_settings b where s.id=b.id;
commit;
-- Before values: companies.name='MASSAIR CT PTY LTD'; profile legal_name/account_name='MASSAIR CT PTY LTD', address_lines={9A Cabernet Rd,Blackheath,Cape Town,7580}, branch_code='250655';
-- settings company_name='0800-BE-COOL', vat/physical/postal NULL, banking account_name='MASSAIR CT (PTY) Ltd'.
