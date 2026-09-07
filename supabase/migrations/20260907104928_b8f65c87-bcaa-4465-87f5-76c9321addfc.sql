DROP TRIGGER IF EXISTS trg_quotes_sent_email ON public.quotes;
DROP TRIGGER IF EXISTS trg_invoices_sent_email ON public.invoices;

GRANT EXECUTE ON FUNCTION public.is_company_member(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_admin(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_company_id(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;