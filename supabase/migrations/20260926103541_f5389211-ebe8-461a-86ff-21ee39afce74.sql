CREATE OR REPLACE FUNCTION public.can_access_receipt_folder(_folder text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    _folder = public.get_user_company_id(auth.uid())::text
    OR EXISTS (SELECT 1 FROM public.leads l
               WHERE l.id::text = _folder
                 AND l.company_id = public.get_user_company_id(auth.uid()))
  )
$$;
REVOKE ALL ON FUNCTION public.can_access_receipt_folder(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_receipt_folder(text) TO authenticated;

DROP POLICY IF EXISTS "Auth users can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete own receipts" ON storage.objects;

CREATE POLICY "Company can view receipts" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts' AND public.can_access_receipt_folder((storage.foldername(name))[1]));
CREATE POLICY "Company can upload receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts' AND public.can_access_receipt_folder((storage.foldername(name))[1]));
CREATE POLICY "Company can delete receipts" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts' AND public.can_access_receipt_folder((storage.foldername(name))[1]));