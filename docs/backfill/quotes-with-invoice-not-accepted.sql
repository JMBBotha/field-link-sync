-- Read-only list. Do not run this as a backfill and do not update these rows from here.
-- Quotes that are still draft or sent and already have a live (not void, not cancelled) invoice.
-- An archived quote is listed when its status is still draft or sent. The trigger does not accept it.
-- One row per quote. Invoice number, status and date are listed in created order.

SELECT
  q.quote_number,
  COALESCE(NULLIF(btrim(q.customer_name), ''), NULLIF(btrim(c.name), ''), 'No client name') AS client,
  q.total,
  q.status,
  string_agg(COALESCE(i.invoice_number, '(no number)'), ', ' ORDER BY i.created_at, i.id) AS invoice_numbers,
  string_agg(COALESCE(NULLIF(btrim(i.status), ''), '(no status)'), ', ' ORDER BY i.created_at, i.id) AS invoice_statuses,
  string_agg(to_char(COALESCE(i.issue_date::date, i.created_at::date), 'YYYY-MM-DD'), ', ' ORDER BY i.created_at, i.id) AS invoice_dates
FROM public.quotes q
LEFT JOIN public.customers c ON c.id = q.customer_id
JOIN public.invoices i
  ON i.quote_id = q.id
 AND COALESCE(i.status, '') NOT IN ('void', 'cancelled', 'canceled')
WHERE q.status IN ('draft', 'sent')
GROUP BY q.id, q.quote_number, q.customer_name, c.name, q.total, q.status
ORDER BY q.quote_number NULLS LAST, q.id;
