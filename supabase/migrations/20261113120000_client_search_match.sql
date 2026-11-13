-- Client search also matches the name column, search_aliases, and both phone
-- digit forms (071… and +27…). SECURITY INVOKER is unchanged, so RLS still
-- decides which companies' rows a caller can see. Do not apply this by hand
-- on production; it ships with the migration only.
-- The app search does not depend on this function: it loads the signed-in
-- company's customers and matches in the client. This keeps search_customers
-- (quote voice, Mandy, the customer selector) on the same rules.

CREATE OR REPLACE FUNCTION public.search_customers(search_term text, max_results integer DEFAULT 20)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  company_name text,
  is_company boolean,
  phone text,
  email text,
  primary_address_line1 text,
  city text,
  status text,
  relevance real
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  norm_term text;
  phone_term text;
  phone_local text;
BEGIN
  IF search_term IS NULL OR trim(search_term) = '' THEN
    RETURN QUERY
      SELECT c.id, c.first_name, c.last_name, c.company_name, c.is_company,
             c.phone, c.email, c.primary_address_line1, c.city, c.status, 1.0::real
      FROM customers c
      ORDER BY c.updated_at DESC
      LIMIT max_results;
    RETURN;
  END IF;

  norm_term := lower(trim(search_term));
  phone_term := regexp_replace(search_term, '[^0-9]', '', 'g');
  phone_local := COALESCE(public.normalize_phone(search_term), '');

  RETURN QUERY
    SELECT c.id, c.first_name, c.last_name, c.company_name, c.is_company,
           c.phone, c.email, c.primary_address_line1, c.city, c.status,
           GREATEST(
             similarity(lower(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), norm_term),
             similarity(lower(COALESCE(c.name, '')), norm_term),
             similarity(lower(COALESCE(c.company_name, '')), norm_term),
             CASE WHEN lower(COALESCE(c.name, '')) LIKE '%' || norm_term || '%' THEN 0.85 ELSE 0 END,
             CASE WHEN COALESCE(c.normalized_email, '') LIKE '%' || norm_term || '%'
                    OR lower(COALESCE(c.email, '')) LIKE '%' || norm_term || '%' THEN 0.8 ELSE 0 END,
             CASE WHEN phone_local <> '' AND (
                    COALESCE(c.normalized_phone, '') LIKE '%' || phone_local || '%'
                    OR COALESCE(public.normalize_phone(c.phone), '') LIKE '%' || phone_local || '%'
                    OR COALESCE(public.normalize_phone(c.secondary_phone), '') LIKE '%' || phone_local || '%'
                  ) THEN 0.9 ELSE 0 END,
             CASE WHEN EXISTS (
                    SELECT 1 FROM unnest(COALESCE(c.search_aliases, ARRAY[]::text[])) AS alias(val)
                    WHERE lower(val) LIKE '%' || norm_term || '%'
                  ) THEN 0.75 ELSE 0 END,
             CASE WHEN lower(COALESCE(c.primary_address_line1, '')) ILIKE '%' || norm_term || '%' THEN 0.6 ELSE 0 END
           )::real AS relevance
    FROM customers c
    WHERE
      similarity(lower(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), norm_term) > 0.2
      OR similarity(lower(COALESCE(c.name, '')), norm_term) > 0.2
      OR similarity(lower(COALESCE(c.company_name, '')), norm_term) > 0.2
      OR lower(COALESCE(c.name, '')) LIKE '%' || norm_term || '%'
      OR lower(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE '%' || norm_term || '%'
      OR lower(COALESCE(c.company_name, '')) LIKE '%' || norm_term || '%'
      OR COALESCE(c.normalized_email, '') LIKE '%' || norm_term || '%'
      OR lower(COALESCE(c.email, '')) LIKE '%' || norm_term || '%'
      OR (phone_local <> '' AND (
           COALESCE(c.normalized_phone, '') LIKE '%' || phone_local || '%'
           OR COALESCE(public.normalize_phone(c.phone), '') LIKE '%' || phone_local || '%'
           OR COALESCE(public.normalize_phone(c.secondary_phone), '') LIKE '%' || phone_local || '%'
         ))
      OR (phone_term <> '' AND length(phone_term) >= 3 AND (
           COALESCE(c.phone, '') LIKE '%' || phone_term || '%'
           OR COALESCE(c.secondary_phone, '') LIKE '%' || phone_term || '%'
         ))
      OR lower(COALESCE(c.primary_address_line1, '')) ILIKE '%' || norm_term || '%'
      OR EXISTS (
           SELECT 1 FROM unnest(COALESCE(c.search_aliases, ARRAY[]::text[])) AS alias(val)
           WHERE lower(val) LIKE '%' || norm_term || '%'
         )
    ORDER BY relevance DESC
    LIMIT max_results;
END;
$$;
