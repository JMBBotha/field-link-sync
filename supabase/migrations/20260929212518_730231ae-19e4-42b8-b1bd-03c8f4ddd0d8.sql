CREATE OR REPLACE FUNCTION public.generate_quote_number(p_company_id uuid DEFAULT NULL::uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_year_txt text := to_char(now(), 'YYYY');
  v_next int; v_max int; v_num text;
BEGIN
  IF p_company_id IS NULL THEN
    LOOP
      v_next := nextval('quote_number_seq')::int;
      v_num := 'Q-' || v_year_txt || '-' || CASE WHEN v_next < 10000 THEN LPAD(v_next::text, 4, '0') ELSE v_next::text END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quotes WHERE quote_number = v_num);
    END LOOP;
    RETURN v_num;
  END IF;

  INSERT INTO public.company_quote_counters (company_id, year, last_value)
  VALUES (p_company_id, v_year, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_value = CASE WHEN public.company_quote_counters.year = EXCLUDED.year
                          THEN public.company_quote_counters.last_value + 1 ELSE 1 END,
        year = EXCLUDED.year, updated_at = now()
  RETURNING last_value INTO v_next;

  SELECT COALESCE(max(substring(quote_number FROM '^Q-' || v_year_txt || '-([0-9]+)$')::int), 0) INTO v_max
    FROM public.quotes WHERE quote_number LIKE 'Q-' || v_year_txt || '-%';
  v_next := greatest(v_next, v_max + 1);
  LOOP
    v_num := 'Q-' || v_year_txt || '-' || CASE WHEN v_next < 10000 THEN LPAD(v_next::text, 4, '0') ELSE v_next::text END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quotes WHERE quote_number = v_num);
    v_next := v_next + 1;
  END LOOP;
  UPDATE public.company_quote_counters SET last_value = v_next WHERE company_id = p_company_id;
  RETURN v_num;
END;
$function$;

UPDATE public.company_quote_counters SET last_value = GREATEST(last_value, 22), updated_at = now()
 WHERE company_id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' AND year = 2026;