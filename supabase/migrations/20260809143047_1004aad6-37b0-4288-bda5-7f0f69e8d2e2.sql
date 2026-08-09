-- 1. Optional alias / synonym fields ---------------------------------------
ALTER TABLE public.customers        ADD COLUMN IF NOT EXISTS search_aliases text[] DEFAULT '{}'::text[];
ALTER TABLE public.profiles         ADD COLUMN IF NOT EXISTS search_aliases text[] DEFAULT '{}'::text[];
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS search_aliases text[] DEFAULT '{}'::text[];

-- 2. Trigram indexes for the fuzzy paths ------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_name_col_trgm ON public.customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_customer_name_trgm ON public.leads USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_company_name_trgm ON public.leads USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm ON public.jobs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotes_number_trgm ON public.quotes USING gin (quote_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_name_trgm ON public.quotes USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sp_name_trgm ON public.supplier_products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sp_description_trgm ON public.supplier_products USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sp_model_trgm ON public.supplier_products USING gin (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sp_code_trgm ON public.supplier_products USING gin (product_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm ON public.profiles USING gin (full_name gin_trgm_ops);

-- 3. Normalisation helper: lowercase, strip punctuation, collapse spaces -----
CREATE OR REPLACE FUNCTION public.fuzzy_normalize(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Digits only (phone matching)
CREATE OR REPLACE FUNCTION public.fuzzy_digits(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(coalesce(p_text, ''), '[^0-9]', '', 'g');
$$;

-- Best score across a set of candidate haystacks for one needle.
-- Combines trigram similarity with substring/prefix and phone-digit boosts.
CREATE OR REPLACE FUNCTION public.fuzzy_score(p_query text, p_haystacks text[])
RETURNS real
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  q      text := public.fuzzy_normalize(p_query);
  qd     text := public.fuzzy_digits(p_query);
  h      text;
  hn     text;
  hd     text;
  s      real;
  best   real := 0;
BEGIN
  IF q = '' AND qd = '' THEN RETURN 0; END IF;

  FOREACH h IN ARRAY coalesce(p_haystacks, ARRAY[]::text[]) LOOP
    CONTINUE WHEN h IS NULL OR btrim(h) = '';
    hn := public.fuzzy_normalize(h);
    hd := public.fuzzy_digits(h);

    -- phone / numeric reference match
    IF length(qd) >= 5 AND hd <> '' AND (hd LIKE '%' || qd || '%' OR qd LIKE '%' || hd || '%') THEN
      best := greatest(best, 0.99::real);
      CONTINUE;
    END IF;

    CONTINUE WHEN hn = '';

    s := similarity(q, hn);
    IF hn = q THEN
      s := 1.0;
    ELSIF hn LIKE q || '%' THEN
      s := greatest(s, 0.92::real);           -- prefix / partial name
    ELSIF position(q in hn) > 0 THEN
      s := greatest(s, 0.85::real);           -- contained
    ELSE
      -- token-level: every query word fuzzily present in the haystack
      s := greatest(s, (
        SELECT CASE WHEN count(*) = 0 OR bool_and(tok_hit) IS NOT TRUE THEN 0
                    ELSE 0.80::real END
        FROM (
          SELECT EXISTS (
            SELECT 1 FROM regexp_split_to_table(hn, '\s+') AS hw
            WHERE hw = qw OR hw LIKE qw || '%' OR similarity(qw, hw) > 0.55
          ) AS tok_hit
          FROM regexp_split_to_table(q, '\s+') AS qw
          WHERE length(qw) > 1
        ) t
      ));
    END IF;

    best := greatest(best, s);
  END LOOP;

  RETURN least(best, 1.0::real);
END;
$$;

-- 4. Reusable entity resolver ------------------------------------------------
-- Runs as the calling user (SECURITY INVOKER) so RLS still governs visibility.
CREATE OR REPLACE FUNCTION public.search_entities_fuzzy(
  p_entity_type text,
  p_query       text,
  p_company_id  uuid DEFAULT NULL,
  p_limit       integer DEFAULT 5,
  p_min_score   real DEFAULT 0.25
)
RETURNS TABLE(
  entity_type text,
  id          uuid,
  label       text,
  sublabel    text,
  reference   text,
  score       real
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  co uuid := coalesce(p_company_id, public.get_user_company_id());
  et text := lower(coalesce(p_entity_type, 'all'));
  lim integer := greatest(1, least(coalesce(p_limit, 5), 25));
BEGIN
  IF coalesce(btrim(p_query), '') = '' THEN RETURN; END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT 'customer'::text AS entity_type, c.id,
           coalesce(nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
                    c.company_name, c.name) AS label,
           coalesce(c.phone, c.email, c.city) AS sublabel,
           c.phone AS reference,
           public.fuzzy_score(p_query, ARRAY[c.name, c.first_name, c.last_name,
             btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
             c.company_name, c.email, c.normalized_email, c.phone, c.normalized_phone,
             c.secondary_phone] || coalesce(c.search_aliases, '{}'::text[])) AS score
    FROM public.customers c
    WHERE et IN ('customer', 'all') AND (co IS NULL OR c.company_id = co)

    UNION ALL
    SELECT 'lead', l.id,
           coalesce(l.customer_name, l.company_name, 'Lead'),
           coalesce(l.service_type, l.customer_address),
           l.customer_phone,
           public.fuzzy_score(p_query, ARRAY[l.customer_name, l.company_name,
             l.customer_phone, l.phone, l.email, l.service_type, l.customer_address])
    FROM public.leads l
    WHERE et IN ('lead', 'all') AND l.deleted_at IS NULL AND (co IS NULL OR l.company_id = co)

    UNION ALL
    SELECT 'job', j.id, j.title, coalesce(j.status, j.job_type), j.id::text,
           public.fuzzy_score(p_query, ARRAY[j.title, j.description, j.address,
             j.job_type, left(j.id::text, 8)])
    FROM public.jobs j
    WHERE et IN ('job', 'all') AND (co IS NULL OR j.company_id = co)

    UNION ALL
    SELECT 'quote', q.id, coalesce(q.quote_number, 'Draft quote'),
           coalesce(q.customer_name, q.status), q.quote_number,
           public.fuzzy_score(p_query, ARRAY[q.quote_number, q.customer_name, q.reference_text])
    FROM public.quotes q
    WHERE et IN ('quote', 'all') AND (co IS NULL OR q.company_id = co)

    UNION ALL
    SELECT 'product', sp.id,
           coalesce(sp.name, sp.short_name, sp.description),
           coalesce(sp.brand, sp.category),
           coalesce(sp.model, sp.product_code),
           public.fuzzy_score(p_query, ARRAY[sp.name, sp.short_name, sp.description,
             sp.model, sp.product_code, sp.brand, sp.model_range]
             || coalesce(sp.search_aliases, '{}'::text[]))
    FROM public.supplier_products sp
    WHERE et IN ('product', 'all') AND sp.is_active AND NOT coalesce(sp.archived, false)

    UNION ALL
    SELECT 'staff', pr.id, pr.full_name, pr.dispatch_role, pr.phone,
           public.fuzzy_score(p_query, ARRAY[pr.full_name, pr.phone, pr.dispatch_role]
             || coalesce(pr.search_aliases, '{}'::text[]))
    FROM public.profiles pr
    WHERE et IN ('staff', 'all') AND (co IS NULL OR pr.company_id = co)
  )
  SELECT c.entity_type, c.id, c.label, c.sublabel, c.reference, c.score
  FROM candidates c
  WHERE c.score >= coalesce(p_min_score, 0.25)
  ORDER BY c.score DESC, c.label ASC
  LIMIT lim;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fuzzy_normalize(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fuzzy_digits(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fuzzy_score(text, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_entities_fuzzy(text, text, uuid, integer, real) TO authenticated, service_role;