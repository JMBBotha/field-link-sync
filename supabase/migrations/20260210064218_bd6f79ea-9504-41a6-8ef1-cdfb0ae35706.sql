
-- Fix: recreate both functions using correct column name "phone" instead of "primary_phone"

CREATE OR REPLACE FUNCTION public.sync_lead_to_customer()
RETURNS TRIGGER AS $$
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
      address, primary_address_line1, status
    ) VALUES (
      NEW.customer_name,
      v_first_name,
      v_last_name,
      NEW.customer_phone,
      v_normalized_phone,
      NEW.customer_address,
      NEW.customer_address,
      'lead'
    )
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.backfill_leads_to_customers()
RETURNS jsonb AS $$
DECLARE
  v_lead record;
  v_customer_id uuid;
  v_normalized_phone text;
  v_first_name text;
  v_last_name text;
  v_parts text[];
  v_linked int := 0;
  v_created int := 0;
BEGIN
  FOR v_lead IN
    SELECT id, customer_name, customer_phone, customer_address
    FROM leads
    WHERE customer_id IS NULL
  LOOP
    v_normalized_phone := regexp_replace(v_lead.customer_phone, '[\s\-\(\)]', '', 'g');
    v_normalized_phone := regexp_replace(v_normalized_phone, '^\+?27', '0');

    SELECT id INTO v_customer_id
    FROM customers
    WHERE normalized_phone = v_normalized_phone
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      v_parts := string_to_array(trim(v_lead.customer_name), ' ');
      v_first_name := v_parts[1];
      IF array_length(v_parts, 1) > 1 THEN
        v_last_name := array_to_string(v_parts[2:], ' ');
      END IF;

      INSERT INTO customers (
        name, first_name, last_name, phone, normalized_phone,
        address, primary_address_line1, status
      ) VALUES (
        v_lead.customer_name,
        v_first_name,
        v_last_name,
        v_lead.customer_phone,
        v_normalized_phone,
        v_lead.customer_address,
        v_lead.customer_address,
        'lead'
      )
      RETURNING id INTO v_customer_id;
      v_created := v_created + 1;
    ELSE
      v_linked := v_linked + 1;
    END IF;

    UPDATE leads SET customer_id = v_customer_id WHERE id = v_lead.id;
  END LOOP;

  RETURN jsonb_build_object('linked', v_linked, 'created', v_created);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
