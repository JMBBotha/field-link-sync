CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customers_trgm_full_name
  ON public.customers USING gin (lower(first_name || ' ' || COALESCE(last_name, '')) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.check_customer_duplicates(
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  phone text,
  email text,
  primary_address_line1 text,
  match_type text,
  match_score real
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  norm_phone text;
  norm_email text;
  input_name text;
BEGIN
  norm_phone := normalize_phone(p_phone);
  norm_email := lower(trim(COALESCE(p_email, '')));
  input_name := lower(trim(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')));

  RETURN QUERY
    WITH scored AS (
      SELECT
        c.id, c.first_name, c.last_name, c.phone, c.email, c.primary_address_line1,
        (norm_email != '' AND c.normalized_email = norm_email) AS email_hit,
        (norm_phone IS NOT NULL AND c.normalized_phone = norm_phone) AS phone_hit,
        similarity(input_name, lower(c.first_name || ' ' || COALESCE(c.last_name, ''))) AS name_sim
      FROM public.customers c
      WHERE
        (norm_email != '' AND c.normalized_email = norm_email)
        OR (norm_phone IS NOT NULL AND c.normalized_phone = norm_phone)
        OR (p_first_name IS NOT NULL AND input_name % lower(c.first_name || ' ' || COALESCE(c.last_name, '')))
    )
    SELECT
      s.id, s.first_name, s.last_name, s.phone, s.email, s.primary_address_line1,
      CASE
        WHEN s.email_hit THEN 'exact_email'
        WHEN s.phone_hit THEN 'exact_phone'
        ELSE 'name_suggestion'
      END AS match_type,
      CASE
        -- Auto-link only when phone/email agrees; keep the 0.8 auto-link threshold
        WHEN s.email_hit OR s.phone_hit
          THEN GREATEST(0.8, COALESCE(s.name_sim, 0))::real
        -- Name-only: cap at 0.88 and only surface strong-enough ones as suggestions
        ELSE s.name_sim::real
      END AS match_score
    FROM scored s
    WHERE
      s.email_hit
      OR s.phone_hit
      OR (s.name_sim >= 0.75 AND s.name_sim <= 0.88)
    ORDER BY match_score DESC
    LIMIT 10;
END;
$function$;