DO $$ DECLARE v text; BEGIN
  SELECT definition INTO v FROM public._acct_backups WHERE step='acctco' AND object='get_public_quote' ORDER BY id DESC LIMIT 1;
  IF v IS NULL THEN RAISE EXCEPTION 'no backup'; END IF; EXECUTE v; END $$;
ALTER TABLE public.invoices ALTER COLUMN tax_rate SET DEFAULT 0;
UPDATE public.company_settings s SET company_name = b.definition
  FROM (SELECT definition FROM public._acct_backups WHERE step='acctco' AND object='company_settings.company_name d315b11c-30e1-429b-ab36-50c56d43fde8' ORDER BY id DESC LIMIT 1) b
 WHERE s.id = 'd315b11c-30e1-429b-ab36-50c56d43fde8';
