CREATE OR REPLACE FUNCTION public.activate_pdf_book_gate(p_pdf_upload_id uuid, p_sample_n integer DEFAULT 10)
RETURNS TABLE(
  product_code text,
  brand text,
  page_number integer,
  list_ex numeric,
  cost_ex numeric,
  discount_used numeric,
  markup_used numeric,
  expected_cost numeric,
  expected_sell numeric,
  selling_price numeric,
  gate_flag text,
  cost_delta numeric,
  sell_minus_list numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH book AS (
  SELECT id, markup_percent AS book_markup, trade_discount_percent AS book_discount
  FROM pdf_uploads
  WHERE id = p_pdf_upload_id
),
pool AS (
  SELECT sp.*,
    COALESCE(NULLIF(sp.default_markup_percent,0), NULLIF(sp.markup_percent,0), NULLIF(b.book_markup,0), 35) AS markup_used,
    COALESCE(NULLIF(sp.supplier_discount_percent,0), NULLIF(b.book_discount,0), 0) AS discount_used,
    sp.list_price_raw AS list_ex,
    sp.cost_price AS cost_ex,
    COALESCE(sp.page_number, 0) AS page_key
  FROM supplier_products sp
  CROSS JOIN book b
  WHERE sp.pdf_upload_id = b.id
),
ranked AS (
  SELECT p.*, ROW_NUMBER() OVER (PARTITION BY page_key ORDER BY random()) AS rn_page
  FROM pool p
),
picked AS (
  SELECT * FROM ranked WHERE rn_page <= 2 ORDER BY random() LIMIT GREATEST(COALESCE(p_sample_n,10),1)
),
calc AS (
  SELECT
    picked.product_code,
    picked.brand,
    picked.page_number,
    list_ex,
    cost_ex,
    picked.selling_price,
    discount_used,
    markup_used,
    CASE WHEN list_ex IS NULL OR list_ex <= 0 THEN NULL
         ELSE ROUND((list_ex * (1 - discount_used/100.0))::numeric, 4) END AS expected_cost,
    ROUND((COALESCE(cost_ex,0) * (1 + markup_used/100.0))::numeric, 2) AS expected_sell,
    GREATEST(0.05, 0.001 * COALESCE(list_ex, cost_ex, 0)) AS tol
  FROM picked
)
SELECT
  calc.product_code,
  calc.brand,
  calc.page_number,
  calc.list_ex,
  calc.cost_ex,
  calc.discount_used,
  calc.markup_used,
  calc.expected_cost,
  calc.expected_sell,
  calc.selling_price,
  CASE
    WHEN calc.list_ex IS NULL OR calc.list_ex <= 0 THEN 'LIST_MISSING'
    WHEN calc.cost_ex IS NULL OR abs(calc.cost_ex - calc.expected_cost) > calc.tol THEN 'FAIL_COST'
    WHEN abs(calc.expected_sell - calc.list_ex) > calc.tol
      AND abs((1 - calc.discount_used/100.0) * (1 + calc.markup_used/100.0) - 1) < 0.01
      THEN 'FAIL_SELL_NE_LIST'
    WHEN calc.selling_price IS NOT NULL AND abs(calc.expected_sell - calc.selling_price) > calc.tol
      THEN 'FAIL_SELL_STORED'
    ELSE 'PASS'
  END AS gate_flag,
  ROUND((COALESCE(calc.cost_ex,0) - COALESCE(calc.expected_cost,0))::numeric, 2) AS cost_delta,
  ROUND((calc.expected_sell - COALESCE(calc.list_ex,0))::numeric, 2) AS sell_minus_list
FROM calc
ORDER BY 11, 1;
$$;

REVOKE ALL ON FUNCTION public.activate_pdf_book_gate(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_pdf_book_gate(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_pdf_book_gate(uuid, integer) TO service_role;