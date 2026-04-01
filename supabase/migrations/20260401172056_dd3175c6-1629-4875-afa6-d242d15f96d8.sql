
CREATE OR REPLACE FUNCTION public.create_portal_booking(
  p_token uuid,
  p_service_type text,
  p_notes text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_customer_id uuid;
  v_customer record;
  v_lead_id uuid;
BEGIN
  -- Validate token
  v_customer_id := validate_customer_token(p_token);
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired token';
  END IF;

  -- Get customer details
  SELECT id, name, phone, address, company_id
  INTO v_customer
  FROM customers
  WHERE id = v_customer_id;

  -- Create lead scoped to customer's company
  INSERT INTO leads (
    customer_id, customer_name, customer_phone, customer_address,
    service_type, notes, latitude, longitude, status, priority, company_id
  ) VALUES (
    v_customer.id, v_customer.name, v_customer.phone,
    COALESCE(v_customer.address, 'TBC'),
    p_service_type, p_notes, 0, 0, 'pending', 'normal', v_customer.company_id
  )
  RETURNING id INTO v_lead_id;

  RETURN v_lead_id;
END;
$$;
