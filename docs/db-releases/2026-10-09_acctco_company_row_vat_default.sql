-- acctco: all documents use the newest company_settings row ('MASSAIR CT (PTY) LTD'), like invoices/statements.
-- get_public_quote stops pinning the older 'MASSAIR IND CC' row (72a8a391); no rows deleted or changed.
-- New invoices default to 15% VAT if a caller omits tax_rate (was 0). quotes.vat_rate already defaults to 0.15.
DO $$
DECLARE v text := pg_get_functiondef('public.get_public_quote(uuid)'::regprocedure);
  pin text := $p$(id = '72a8a391-b7d6-428f-9f2a-9bf281907648') DESC, $p$;
BEGIN
  IF position(pin IN v) = 0 THEN RAISE EXCEPTION 'pin not found, aborting'; END IF;
  INSERT INTO public._acct_backups(step, object, definition) VALUES ('acctco', 'get_public_quote', v);
  EXECUTE replace(v, pin, '');
END $$;
INSERT INTO public._acct_backups(step, object, definition) VALUES ('acctco', 'invoices.tax_rate default', '0');
ALTER TABLE public.invoices ALTER COLUMN tax_rate SET DEFAULT 15;
-- Relabel only: trim the trailing space on the newest row's name (old value kept in _acct_backups).
INSERT INTO public._acct_backups(step, object, definition) SELECT 'acctco', 'company_settings.company_name ' || id, company_name FROM public.company_settings WHERE id = 'd315b11c-30e1-429b-ab36-50c56d43fde8';
UPDATE public.company_settings SET company_name = btrim(company_name) WHERE id = 'd315b11c-30e1-429b-ab36-50c56d43fde8' AND company_name <> btrim(company_name);
