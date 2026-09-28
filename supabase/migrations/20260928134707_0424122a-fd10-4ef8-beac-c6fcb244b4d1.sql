-- Sandbox cleanup (Johan): hard-delete legacy service tables; catalog_services is the only service list.
ALTER TABLE public.quote_line_items DROP CONSTRAINT IF EXISTS quote_line_items_service_id_fkey;
ALTER TABLE public.quote_template_items DROP CONSTRAINT IF EXISTS quote_template_items_service_id_fkey;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_service_id_fkey;
ALTER TABLE public.proposal_items DROP CONSTRAINT IF EXISTS proposal_items_service_id_fkey;

CREATE OR REPLACE FUNCTION public.revenue_by_service_type()
 RETURNS TABLE(service_category text, total numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT COALESCE(cs.name, 'Other') AS service_category,
         SUM(qli.quantity * qli.unit_price)::numeric AS total
  FROM invoices i
  JOIN quotes q ON i.quote_id = q.id
  JOIN quote_line_items qli ON qli.quote_id = q.id
  LEFT JOIN catalog_services cs ON qli.service_id = cs.id
  WHERE i.status = 'paid'
  GROUP BY cs.name
  ORDER BY total DESC;
END;
$function$;

DELETE FROM public.flat_rate_items WHERE id IS NOT NULL;
DELETE FROM public.hvac_services WHERE id IS NOT NULL;
DELETE FROM public.service_templates WHERE id IS NOT NULL;

DROP TABLE public.flat_rate_items;
DROP TABLE public.hvac_services;
DROP TABLE public.service_templates;