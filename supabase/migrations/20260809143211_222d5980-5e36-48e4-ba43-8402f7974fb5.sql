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
  co uuid := p_company_id;
  et text := lower(coalesce(p_entity_type, 'all'));
  lim integer := greatest(1, least(coalesce(p_limit, 5), 25));
BEGIN
  IF coalesce(btrim(p_query), '') = '' THEN RETURN; END IF;
  IF co IS NULL THEN co := public.get_user_company_id(auth.uid()); END IF;

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