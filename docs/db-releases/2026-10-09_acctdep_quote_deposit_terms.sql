-- acct-dep: client quote terms use the same deposit % as deposit invoices (latest company_settings row).
-- Company name/banking row choice is unchanged; only default_deposit_percentage is overridden.
DO $$
DECLARE v_def text; v_oid oid := 'public.get_public_quote(uuid)'::regprocedure;
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> 'ae3110eec653df3acacf3d0a4b462169' THEN RAISE EXCEPTION 'get_public_quote changed (md5 %), aborting', md5(v_def); END IF;
  INSERT INTO public._acct_backups(step, object, definition) VALUES ('acctdep', 'get_public_quote', v_def);
  v_def := replace(v_def,
    $a$updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/$a$,
    $a$updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/
  v_settings.default_deposit_percentage := (SELECT default_deposit_percentage FROM public.company_settings ORDER BY (company_id IS NOT DISTINCT FROM v_quote.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1); /*acctdep: same row as create_deposit_invoice_for_quote*/$a$);
  IF v_def NOT LIKE '%acctdep%' THEN RAISE EXCEPTION 'anchor not found'; END IF;
  EXECUTE v_def;
END $$;
