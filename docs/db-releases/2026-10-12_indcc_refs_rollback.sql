-- Rollback: Ind CC reference cleanup, company 361bf031 (MASSAIR CT), 2026-10-12
-- Changes made: (1) quote 0003373 terms_text 1.1/2.4/5.2/6.1 -> "Massair CT Pty Limited";
-- (2) company_settings a70c9005 banking_details {} -> FNB CT cheque 63226563591 branch 250 655.
-- Backups: backup_indcc_20261012.quotes / company_settings / company_profiles
begin;
update public.quotes q set terms_text=b.terms_text from backup_indcc_20261012.quotes b
 where q.id=b.id and q.id='1bc98aae-ef8f-5143-8d1c-4d4cbe365382';
update public.company_settings s set banking_details=b.banking_details from backup_indcc_20261012.company_settings b
 where s.id=b.id and s.id='a70c9005-45a7-444a-8b49-249a83b490b0';
commit;
