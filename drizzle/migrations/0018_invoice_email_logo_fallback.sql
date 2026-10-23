DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['invoice_email_preview','notify_document_sent'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f LIMIT 1;
    IF position('data-logo-fallback' in d) > 0 THEN CONTINUE; END IF;
    d := replace(d, 'LIMIT 1), '''') || ''<h1', 'LIMIT 1), CASE WHEN v_company ILIKE ''massair%'' THEN ''<img data-logo-fallback src="https://field-link-sync.lovable.app/email/logo-white.png" alt="'' || v_company || ''" height="48" style="display:block;margin:0 auto 10px;height:48px;max-width:220px;border:0;">'' ELSE '''' END) || ''<h1');
    EXECUTE d;
  END LOOP;
END $$;