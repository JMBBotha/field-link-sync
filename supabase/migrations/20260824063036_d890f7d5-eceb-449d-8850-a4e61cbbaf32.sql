GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_line_items TO authenticated;
GRANT ALL ON public.quote_line_items TO service_role;
REVOKE ALL ON public.quote_line_items FROM anon;