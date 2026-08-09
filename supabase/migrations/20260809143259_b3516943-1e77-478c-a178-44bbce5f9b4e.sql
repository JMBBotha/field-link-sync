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

    -- phone / long numeric reference match (both sides must be phone-length)
    IF length(qd) >= 7 AND length(hd) >= 7
       AND (hd LIKE '%' || qd || '%' OR qd LIKE '%' || hd || '%') THEN
      best := greatest(best, 0.99::real);
      CONTINUE;
    END IF;

    CONTINUE WHEN hn = '';

    s := similarity(q, hn);
    IF hn = q THEN
      s := 1.0;
    ELSIF hn LIKE q || '%' THEN
      s := greatest(s, 0.92::real);
    ELSIF position(q in hn) > 0 THEN
      s := greatest(s, 0.85::real);
    ELSE
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