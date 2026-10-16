-- cag1: archive/delete clients = admins + office dispatchers only (not sales reps, not techs)
DO $m$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.delete_or_archive_client(uuid,text)'::regprocedure);
  d := replace(d, 'IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),''admin'') OR public.has_role(auth.uid(),''dispatcher'')) THEN',
    'IF auth.uid() IS NULL OR public.is_sales_rep(auth.uid()) OR public.is_field_tech_only(auth.uid()) OR NOT (public.has_role(auth.uid(),''admin'') OR public.has_role(auth.uid(),''dispatcher'')) THEN /*cag1*/');
  IF position('/*cag1*/' in d) = 0 THEN RAISE EXCEPTION 'cag1 anchor not found'; END IF;
  EXECUTE d;
-- cag2: invoice from a quote the client has not accepted = office only (sales reps blocked)
  d := pg_get_functiondef('public.trg_invoice_guard()'::regprocedure);
  d := replace(d, E'  IF TG_OP = ''INSERT'' THEN\n',
    E'  IF TG_OP = ''INSERT'' AND NEW.quote_id IS NOT NULL AND auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())\n     AND COALESCE(current_setting(''app.public_quote_accept'', true), '''') IS DISTINCT FROM NEW.quote_id::text\n     AND EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.id = NEW.quote_id AND qq.status IS DISTINCT FROM ''accepted'') THEN\n    RAISE EXCEPTION ''Only the office can invoice a quote the client has not accepted'' USING ERRCODE = ''42501''; /*cag2*/\n  END IF;\n  IF TG_OP = ''INSERT'' THEN\n');
  IF position('/*cag2*/' in d) = 0 THEN RAISE EXCEPTION 'cag2 anchor not found'; END IF;
  EXECUTE d;
END $m$;
