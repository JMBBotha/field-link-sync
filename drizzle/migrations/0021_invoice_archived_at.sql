ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE OR REPLACE FUNCTION public.archive_void_invoice(p_invoice_id uuid, p_archive boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_status text;
BEGIN
  SELECT company_id, status INTO v_company, v_status FROM public.invoices WHERE id = p_invoice_id;
  IF v_company IS NULL OR v_company IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'dispatcher')) THEN RAISE EXCEPTION 'Only office staff can archive invoices'; END IF;
  IF v_status NOT IN ('void','cancelled') THEN RAISE EXCEPTION 'Only voided or cancelled invoices can be archived'; END IF;
  UPDATE public.invoices SET archived_at = CASE WHEN p_archive THEN now() ELSE NULL END WHERE id = p_invoice_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.archive_void_invoice(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_void_invoice(uuid, boolean) TO authenticated;