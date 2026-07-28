
-- 1) Per-company quote number counters
CREATE TABLE IF NOT EXISTS public.company_quote_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  year int NOT NULL,
  last_value int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_quote_counters TO authenticated;
GRANT ALL    ON public.company_quote_counters TO service_role;
ALTER TABLE public.company_quote_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own counter" ON public.company_quote_counters;
CREATE POLICY "Members read own counter"
  ON public.company_quote_counters FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), company_id));

-- 2) Replace generate_quote_number with per-company variant (keeps global fallback)
CREATE OR REPLACE FUNCTION public.generate_quote_number(p_company_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_year_txt text := to_char(now(), 'YYYY');
  v_next int;
BEGIN
  IF p_company_id IS NULL THEN
    v_next := nextval('quote_number_seq')::int;
    RETURN 'Q-' || v_year_txt || '-' || LPAD(v_next::text, 4, '0');
  END IF;

  INSERT INTO public.company_quote_counters (company_id, year, last_value)
  VALUES (p_company_id, v_year, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_value = CASE
                       WHEN public.company_quote_counters.year = EXCLUDED.year
                         THEN public.company_quote_counters.last_value + 1
                       ELSE 1
                     END,
        year = EXCLUDED.year,
        updated_at = now()
  RETURNING last_value INTO v_next;

  RETURN 'Q-' || v_year_txt || '-' || LPAD(v_next::text, 4, '0');
END;
$$;

-- 3) Update auto-assign trigger to use company scope when present
CREATE OR REPLACE FUNCTION public.auto_assign_quote_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    NEW.quote_number := public.generate_quote_number(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Preserve original legacy total for orphan placeholders on the quote itself
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS legacy_original_total numeric;

UPDATE public.quotes q
   SET legacy_original_total = COALESCE(q.total, q.subtotal)
  FROM public.quote_items qi
 WHERE qi.quote_id = q.id
   AND qi.source = 'legacy_placeholder'
   AND q.legacy_original_total IS NULL;

-- 5) Mark legacy table for deprecation (drop after 14-day cutover window)
COMMENT ON TABLE public.quote_line_items IS
  'DEPRECATED 2026-07-28: superseded by quote_items. Read-only. Scheduled for DROP after 2026-08-11 once no reads remain.';
