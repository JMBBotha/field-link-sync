
CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_invoice_id uuid;
  new_inv_number text;
  cust record;
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    IF EXISTS (SELECT 1 FROM invoices WHERE quote_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT name, phone, email, address INTO cust FROM customers WHERE id = NEW.customer_id;
    new_inv_number := generate_invoice_number();

    INSERT INTO invoices (
      quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total,
      due_date, status, line_items, company_id
    ) VALUES (
      NEW.id, NEW.lead_id, NEW.sales_engineer_id, NEW.customer_id,
      COALESCE(cust.name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
      new_inv_number, NEW.subtotal, NEW.vat_rate, NEW.vat_amount, NEW.total,
      CURRENT_DATE + 30, 'draft', '[]'::jsonb, NEW.company_id
    )
    RETURNING id INTO new_invoice_id;

    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
    SELECT new_invoice_id, description, quantity, unit_price, quantity * unit_price
    FROM quote_line_items
    WHERE quote_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;
