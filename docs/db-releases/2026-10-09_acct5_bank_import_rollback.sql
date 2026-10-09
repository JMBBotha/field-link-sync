-- acct5 rollback: drop RPCs, archive the table (rename). Payments/expenses created by confirmations stay (they are real records).
DROP FUNCTION IF EXISTS public.unmatch_bank_line(uuid);
DROP FUNCTION IF EXISTS public.confirm_bank_line(uuid, text, uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.bank_match_suggestions(uuid);
DROP FUNCTION IF EXISTS public.import_bank_lines(jsonb, text);
ALTER TABLE IF EXISTS public.bank_lines RENAME TO bank_lines_archived_acct5;
DROP FUNCTION IF EXISTS public._bank_norm(text);
