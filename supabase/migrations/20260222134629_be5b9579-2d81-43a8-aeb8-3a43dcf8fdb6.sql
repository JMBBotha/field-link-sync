
CREATE MATERIALIZED VIEW public.company_stats AS
SELECT
  c.id AS company_id,
  COALESCE(inv.overdue_count, 0) AS overdue_count,
  COALESCE(inv.revenue, 0) AS revenue,
  COALESCE(exp.expenses_total, 0) AS expenses_total
FROM public.companies c
LEFT JOIN (
  SELECT
    company_id,
    COUNT(*) FILTER (WHERE status = 'Overdue') AS overdue_count,
    SUM(total_amount) FILTER (WHERE status = 'Paid') AS revenue
  FROM public.company_invoices
  GROUP BY company_id
) inv ON inv.company_id = c.id
LEFT JOIN (
  SELECT company_id, SUM(amount) AS expenses_total
  FROM public.fb_expenses
  GROUP BY company_id
) exp ON exp.company_id = c.id;

CREATE UNIQUE INDEX ON public.company_stats(company_id);
