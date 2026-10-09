DO $$ DECLARE v text; BEGIN
  SELECT definition INTO v FROM public._acct_backups WHERE step='acctdep' AND object='get_public_quote' ORDER BY id DESC LIMIT 1;
  IF v IS NULL THEN RAISE EXCEPTION 'no backup'; END IF; EXECUTE v; END $$;
