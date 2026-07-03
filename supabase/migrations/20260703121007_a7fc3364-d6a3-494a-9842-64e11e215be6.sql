
CREATE OR REPLACE FUNCTION public.mirror_job_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_cust_name text;
  v_cust_phone text;
  v_cust_addr text;
  v_cust_addr2 text;
  v_cust_lat numeric;
  v_cust_lng numeric;
  v_name text;
  v_phone text;
  v_address text;
  v_lat numeric;
  v_lng numeric;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET customer_id = COALESCE(customer_id, NEW.customer_id),
           status = CASE
             WHEN NEW.status = 'completed' THEN 'completed'
             WHEN NEW.status = 'in_progress' THEN 'in_progress'
             WHEN NEW.status = 'cancelled' THEN 'cancelled'
             ELSE status
           END,
           updated_at = now()
     WHERE id = NEW.lead_id;
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT name, phone, address, primary_address_line1, latitude, longitude
      INTO v_cust_name, v_cust_phone, v_cust_addr, v_cust_addr2, v_cust_lat, v_cust_lng
      FROM public.customers WHERE id = NEW.customer_id;
  END IF;

  v_name    := COALESCE(v_cust_name, NEW.title, 'Job');
  v_phone   := COALESCE(v_cust_phone, 'N/A');
  v_address := COALESCE(NEW.address, v_cust_addr, v_cust_addr2, 'N/A');
  v_lat     := COALESCE(NEW.lat, v_cust_lat, 0);
  v_lng     := COALESCE(NEW.lng, v_cust_lng, 0);

  INSERT INTO public.leads (
    customer_name, customer_phone, customer_address,
    latitude, longitude, service_type, status, priority,
    notes, customer_id, company_id, created_at
  ) VALUES (
    v_name, v_phone, v_address, v_lat, v_lng,
    COALESCE(NEW.job_type, 'service'),
    CASE NEW.status
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'completed'   THEN 'completed'
      WHEN 'cancelled'   THEN 'cancelled'
      ELSE 'pending'
    END,
    COALESCE(NEW.priority, 'normal'),
    NEW.description, NEW.customer_id, NEW.company_id, now()
  )
  RETURNING id INTO v_lead_id;

  NEW.lead_id := v_lead_id;
  RETURN NEW;
END;
$$;
