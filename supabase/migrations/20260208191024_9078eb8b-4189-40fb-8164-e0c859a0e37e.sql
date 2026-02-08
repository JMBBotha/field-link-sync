
-- Revenue trend monthly (last 12 months from paid invoices)
CREATE OR REPLACE FUNCTION public.revenue_trend_monthly()
RETURNS TABLE(month text, revenue numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(gs.m, 'Mon YYYY') as month,
    COALESCE(SUM(i.grand_total), 0)::numeric as revenue
  FROM generate_series(
    date_trunc('month', now()) - interval '11 months',
    date_trunc('month', now()),
    interval '1 month'
  ) gs(m)
  LEFT JOIN invoices i ON date_trunc('month', i.paid_date::timestamp) = gs.m AND i.status = 'paid'
  GROUP BY gs.m
  ORDER BY gs.m;
END;
$$;

-- Revenue by agent
CREATE OR REPLACE FUNCTION public.revenue_by_agent()
RETURNS TABLE(agent_name text, total_revenue numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.full_name as agent_name,
    COALESCE(SUM(i.grand_total), 0)::numeric as total_revenue
  FROM invoices i
  JOIN profiles p ON i.agent_id = p.id
  WHERE i.status = 'paid'
  GROUP BY p.full_name
  ORDER BY total_revenue DESC;
END;
$$;

-- Revenue by service type
CREATE OR REPLACE FUNCTION public.revenue_by_service_type()
RETURNS TABLE(service_category text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(hs.category, 'Other') as service_category,
    SUM(qli.quantity * qli.unit_price)::numeric as total
  FROM invoices i
  JOIN quotes q ON i.quote_id = q.id
  JOIN quote_line_items qli ON qli.quote_id = q.id
  LEFT JOIN hvac_services hs ON qli.service_id = hs.id
  WHERE i.status = 'paid'
  GROUP BY hs.category
  ORDER BY total DESC;
END;
$$;

-- Quote conversion funnel
CREATE OR REPLACE FUNCTION public.quote_conversion_funnel()
RETURNS TABLE(status text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT q.status, COUNT(*)::bigint as count
  FROM quotes q
  GROUP BY q.status
  ORDER BY CASE q.status
    WHEN 'draft' THEN 1
    WHEN 'sent' THEN 2
    WHEN 'viewed' THEN 3
    WHEN 'accepted' THEN 4
    WHEN 'declined' THEN 5
  END;
END;
$$;

-- Agent performance scores
CREATE OR REPLACE FUNCTION public.agent_performance_scores()
RETURNS TABLE(agent_name text, jobs_completed bigint, total_revenue numeric, avg_completion_days numeric, performance_score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  max_jobs bigint;
  max_revenue numeric;
  max_speed numeric;
BEGIN
  -- Get max values for normalization
  SELECT MAX(jc), MAX(tr), MAX(acd)
  INTO max_jobs, max_revenue, max_speed
  FROM (
    SELECT
      COUNT(l.id) as jc,
      COALESCE(SUM(inv.grand_total), 0) as tr,
      COALESCE(AVG(EXTRACT(EPOCH FROM (l.completed_at - l.created_at)) / 86400), 0) as acd
    FROM profiles p
    LEFT JOIN leads l ON l.assigned_agent_id = p.id AND l.status = 'completed'
    LEFT JOIN invoices inv ON inv.agent_id = p.id AND inv.status = 'paid'
    GROUP BY p.id
  ) sub;

  RETURN QUERY
  SELECT
    p.full_name as agent_name,
    COUNT(DISTINCT l.id)::bigint as jobs_completed,
    COALESCE(SUM(DISTINCT inv.grand_total), 0)::numeric as total_revenue,
    COALESCE(AVG(EXTRACT(EPOCH FROM (l.completed_at - l.created_at)) / 86400), 0)::numeric as avg_completion_days,
    (
      CASE WHEN COALESCE(max_jobs, 0) = 0 THEN 0 ELSE (COUNT(DISTINCT l.id)::numeric / max_jobs * 40) END +
      CASE WHEN COALESCE(max_revenue, 0) = 0 THEN 0 ELSE (COALESCE(SUM(DISTINCT inv.grand_total), 0) / max_revenue * 30) END +
      CASE WHEN COALESCE(max_speed, 0) = 0 THEN 0 ELSE ((1 - LEAST(COALESCE(AVG(EXTRACT(EPOCH FROM (l.completed_at - l.created_at)) / 86400), 0) / NULLIF(max_speed, 0), 1)) * 30) END
    )::numeric as performance_score
  FROM profiles p
  LEFT JOIN leads l ON l.assigned_agent_id = p.id AND l.status = 'completed'
  LEFT JOIN invoices inv ON inv.agent_id = p.id AND inv.status = 'paid'
  GROUP BY p.id, p.full_name
  HAVING COUNT(DISTINCT l.id) > 0
  ORDER BY performance_score DESC;
END;
$$;
