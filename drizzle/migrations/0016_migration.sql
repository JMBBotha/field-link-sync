DO $$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['invoice_email_preview','notify_document_sent'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f LIMIT 1;
    IF d IS NULL THEN CONTINUE; END IF;
    -- Match the quote email brand: blue gradient header, orange accent, soft blue page.
    d := replace(d, 'background-color:#1B3A5C;padding:24px 32px;', 'background-color:#0B4FA8;background-image:linear-gradient(90deg,#0B4FA8,#1AA7EC);padding:24px 32px;');
    d := replace(d, '#1B3A5C', '#0B4FA8');
    d := replace(d, '#F59E0B', '#F7941D');
    d := replace(d, '<body style="margin:0;padding:0;background-color:#ffffff;', '<body style="margin:0;padding:0;background-color:#eef3f9;');
    EXECUTE d;
  END LOOP;
END $$;