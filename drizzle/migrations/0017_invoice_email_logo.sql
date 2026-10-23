DO $$
DECLARE f text; d text; cid text; old text; new text;
BEGIN
  FOREACH f IN ARRAY ARRAY['invoice_email_preview','notify_document_sent'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f LIMIT 1;
    IF d IS NULL OR position('data-logo' in d) > 0 THEN CONTINUE; END IF;
    cid := CASE WHEN f='invoice_email_preview' THEN 'v_inv.company_id' ELSE 'NEW.company_id' END;
    old := 'text-align:center;"><h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">'' || v_company || ''</h1>''';
    new := 'text-align:center;">'' || COALESCE((SELECT ''<div data-logo style="display:inline-block;background:#ffffff;border-radius:10px;padding:8px 14px;margin:0 0 10px;"><img src="'' || replace(cp.logo_url,''"'',''%22'') || ''" alt="'' || v_company || ''" height="44" style="display:block;height:44px;max-width:200px;border:0;"></div>'' FROM public.company_profiles cp WHERE cp.company_id = ' || cid || ' AND cp.archived_at IS NULL AND cp.logo_url ~ ''^https://'' ORDER BY cp.is_default DESC, cp.created_at LIMIT 1), '''') || ''<h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">'' || v_company || ''</h1>''';
    IF position(old in d) = 0 THEN RAISE EXCEPTION 'banner not found in %', f; END IF;
    d := replace(d, old, new);
    EXECUTE d;
  END LOOP;
END $$;