CREATE TABLE public.quote_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  filename text NOT NULL,
  size_bytes integer,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.quote_documents TO authenticated;
GRANT ALL ON public.quote_documents TO service_role;
ALTER TABLE public.quote_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY qd_select ON public.quote_documents FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id() AND public.photo_quote_ok(quote_id));
CREATE POLICY qd_insert ON public.quote_documents FOR INSERT TO authenticated
  WITH CHECK (company_id = public.caller_company_id() AND public.photo_quote_ok(quote_id)
    AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.company_id = public.caller_company_id()));
CREATE POLICY qd_delete ON public.quote_documents FOR DELETE TO authenticated
  USING (company_id = public.caller_company_id() AND public.photo_quote_ok(quote_id));

CREATE POLICY qdoc_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quote-documents' AND public.quote_photo_ok(name, true));
CREATE POLICY qdoc_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quote-documents' AND public.quote_photo_ok(name, false));
CREATE POLICY qdoc_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quote-documents' AND public.quote_photo_ok(name, false));

CREATE OR REPLACE FUNCTION public.public_quote_documents(p_token text)
RETURNS TABLE(id uuid, filename text, size_bytes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.filename, d.size_bytes FROM public.quote_documents d
  JOIN public.quotes q ON q.id = d.quote_id
  WHERE p_token IS NOT NULL AND length(p_token) >= 16 AND q.public_token::text = p_token
  ORDER BY d.created_at;
$$;
GRANT EXECUTE ON FUNCTION public.public_quote_documents(text) TO anon, authenticated;