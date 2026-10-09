-- acct3 rollback: drop RPCs, archive tables (rename, never delete).
DROP FUNCTION IF EXISTS public.get_public_statement(uuid);
DROP FUNCTION IF EXISTS public.revoke_statement_links(uuid);
DROP FUNCTION IF EXISTS public.create_statement_link(uuid);
DROP FUNCTION IF EXISTS public.customer_statement(uuid, date, date);
DROP FUNCTION IF EXISTS public._customer_statement_build(uuid, date, date);
DROP FUNCTION IF EXISTS public.archive_customer_note(uuid);
ALTER TABLE IF EXISTS public.statement_links RENAME TO statement_links_archived_acct3;
ALTER TABLE IF EXISTS public.customer_notes RENAME TO customer_notes_archived_acct3;
