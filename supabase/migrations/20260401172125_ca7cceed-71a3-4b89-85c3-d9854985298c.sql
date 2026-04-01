
CREATE OR REPLACE FUNCTION public.sync_lead_to_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_normalized_phone text;
  v_first_name text;
  v_last_name text;
  v_parts text[];
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_normalized_phone := regexp_replace(NEW.customer_phone, '[\s\-\(\)]', '', 'g');
  v_normalized_phone := regexp_replace(v_normalized_phone, '^\+?27', '0');

  SELECT id INTO v_customer_id
  FROM customers
  WHERE normalized_phone = v_normalized_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    v_parts := string_to_array(trim(NEW.customer_name), ' ');
    v_first_name := v_parts[1];
    IF array_length(v_parts, 1) > 1 THEN
      v_last_name := array_to_string(v_parts[2:], ' ');
    END IF;

    INSERT INTO customers (
      name, first_name, last_name, phone, normalized_phone,
      address, primary_address_line1, status, company_id
    ) VALUES (
      NEW.customer_name,
      v_first_name,
      v_last_name,
      NEW.customer_phone,
      v_normalized_phone,
      NEW.customer_address,
      NEW.customer_address,
      'lead',
      NEW.company_id
    )
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$function$;
