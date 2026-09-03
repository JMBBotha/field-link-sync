CREATE OR REPLACE FUNCTION public.get_deposit_invoice_by_quote_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(inv)
  FROM (
    SELECT i.id, i.invoice_number, i.status, i.grand_total, i.paid_date, i.notes,
           COALESCE((
             SELECT SUM(p.amount) FROM public.payments p
             WHERE p.invoice_id = i.id AND lower(p.status) = 'paid'
           ), 0) AS amount_paid,
           GREATEST(COALESCE(i.grand_total, 0) - COALESCE((
             SELECT SUM(p.amount) FROM public.payments p
             WHERE p.invoice_id = i.id AND lower(p.status) = 'paid'
           ), 0), 0) AS remaining
    FROM public.quotes q
    JOIN public.invoices i ON i.quote_id = q.id
    WHERE q.public_token = p_token
    ORDER BY i.created_at ASC
    LIMIT 1
  ) inv;
$function$;

GRANT EXECUTE ON FUNCTION public.get_deposit_invoice_by_quote_token(uuid) TO anon, authenticated;