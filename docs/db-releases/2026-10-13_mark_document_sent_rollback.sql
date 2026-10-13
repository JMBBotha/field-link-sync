-- Rollback for 20261013134500_mark_document_sent.sql. Documents already marked keep status 'sent'.
DROP FUNCTION IF EXISTS public.mark_document_sent(text, uuid, text, text);
ALTER TABLE public.quotes   DROP COLUMN IF EXISTS sent_method, DROP COLUMN IF EXISTS sent_channel, DROP COLUMN IF EXISTS sent_note, DROP COLUMN IF EXISTS sent_by;
ALTER TABLE public.invoices DROP COLUMN IF EXISTS sent_method, DROP COLUMN IF EXISTS sent_channel, DROP COLUMN IF EXISTS sent_note, DROP COLUMN IF EXISTS sent_by;
