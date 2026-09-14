DO $mig$
DECLARE src text; newsrc text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname = 'notify_document_sent' AND pronamespace = 'public'::regnamespace;
  IF src IS NULL THEN RETURN; END IF;
  newsrc := replace(src,
    'lower(TG_TABLE_NAME = ''quotes''::text)::text',
    '(CASE WHEN TG_TABLE_NAME = ''quotes'' THEN ''quote'' ELSE ''invoice'' END)');
  EXECUTE 'CREATE OR REPLACE FUNCTION public.notify_document_sent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$' || newsrc || '$fn$';
END
$mig$;