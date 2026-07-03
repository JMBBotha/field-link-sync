
-- 1) Add 'converted' to leads.status check constraint, and converted_at column
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check
  CHECK (status = ANY (ARRAY['pending','accepted','in_progress','completed','cancelled','converted','qualified','won']));

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS converted_at timestamptz;

-- 2) Convert lead -> customer (dedupe by phone/email); links lead.customer_id; reversible.
CREATE OR REPLACE FUNCTION public.convert_lead_to_customer(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_customer_id uuid;
  v_norm_phone text;
  v_parts text[];
  v_first text;
  v_last text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'Lead % not found', p_lead_id;
  END IF;

  -- Already linked? Just ensure status + return
  IF v_lead.customer_id IS NOT NULL THEN
    UPDATE public.leads
      SET status = 'converted', converted_at = COALESCE(converted_at, now())
      WHERE id = p_lead_id;
    RETURN v_lead.customer_id;
  END IF;

  v_norm_phone := public.normalize_phone(v_lead.customer_phone);

  -- Match existing customer by normalized phone within same company (or globally if no company)
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE normalized_phone = v_norm_phone
    AND (v_lead.company_id IS NULL OR company_id = v_lead.company_id OR company_id IS NULL)
  ORDER BY (company_id = v_lead.company_id) DESC NULLS LAST, updated_at DESC
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    -- Update missing fields on existing customer
    UPDATE public.customers c SET
      address = COALESCE(NULLIF(c.address,''), v_lead.customer_address),
      primary_address_line1 = COALESCE(NULLIF(c.primary_address_line1,''), v_lead.customer_address),
      latitude = COALESCE(c.latitude, v_lead.latitude),
      longitude = COALESCE(c.longitude, v_lead.longitude),
      notes = COALESCE(NULLIF(c.notes,''), v_lead.notes),
      company_id = COALESCE(c.company_id, v_lead.company_id),
      status = CASE WHEN c.status = 'lead' THEN 'active' ELSE c.status END,
      updated_at = now()
    WHERE c.id = v_customer_id;
  ELSE
    -- Split name
    v_parts := regexp_split_to_array(trim(v_lead.customer_name), '\s+');
    v_first := v_parts[1];
    IF array_length(v_parts,1) > 1 THEN
      v_last := array_to_string(v_parts[2:], ' ');
    END IF;

    INSERT INTO public.customers (
      name, first_name, last_name, phone, address, primary_address_line1,
      latitude, longitude, notes, status, company_id, lead_source, created_by
    ) VALUES (
      v_lead.customer_name, v_first, v_last, v_lead.customer_phone,
      v_lead.customer_address, v_lead.customer_address,
      v_lead.latitude, v_lead.longitude, v_lead.notes,
      'active', v_lead.company_id, 'other', auth.uid()
    )
    RETURNING id INTO v_customer_id;
  END IF;

  UPDATE public.leads
    SET customer_id = v_customer_id,
        status = 'converted',
        converted_at = now()
    WHERE id = p_lead_id;

  RETURN v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_lead_to_customer(uuid) TO authenticated;

-- 3) Reverse a conversion (unlink customer, revert status to pending). Customer record kept.
CREATE OR REPLACE FUNCTION public.unconvert_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
    SET customer_id = NULL,
        status = 'pending',
        converted_at = NULL
    WHERE id = p_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unconvert_lead(uuid) TO authenticated;

-- 4) Trigger: auto-convert when a lead is set to converted/qualified/won without a customer_id
CREATE OR REPLACE FUNCTION public.auto_convert_lead_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_norm_phone text;
  v_parts text[];
  v_first text;
  v_last text;
BEGIN
  IF NEW.status IN ('converted','qualified','won','accepted','in_progress','completed')
     AND NEW.customer_id IS NULL THEN

    v_norm_phone := public.normalize_phone(NEW.customer_phone);

    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE normalized_phone = v_norm_phone
      AND (NEW.company_id IS NULL OR company_id = NEW.company_id OR company_id IS NULL)
    ORDER BY (company_id = NEW.company_id) DESC NULLS LAST, updated_at DESC
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      v_parts := regexp_split_to_array(trim(NEW.customer_name), '\s+');
      v_first := v_parts[1];
      IF array_length(v_parts,1) > 1 THEN
        v_last := array_to_string(v_parts[2:], ' ');
      END IF;

      INSERT INTO public.customers (
        name, first_name, last_name, phone, address, primary_address_line1,
        latitude, longitude, notes, status, company_id, lead_source
      ) VALUES (
        NEW.customer_name, v_first, v_last, NEW.customer_phone,
        NEW.customer_address, NEW.customer_address,
        NEW.latitude, NEW.longitude, NEW.notes,
        'active', NEW.company_id, 'other'
      )
      RETURNING id INTO v_customer_id;
    END IF;

    NEW.customer_id := v_customer_id;
    IF NEW.status = 'converted' AND NEW.converted_at IS NULL THEN
      NEW.converted_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_convert_lead ON public.leads;
CREATE TRIGGER trg_auto_convert_lead
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_convert_lead_on_status();
