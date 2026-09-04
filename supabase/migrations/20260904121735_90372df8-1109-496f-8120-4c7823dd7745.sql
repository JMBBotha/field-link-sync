CREATE OR REPLACE FUNCTION public.get_public_quote(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_settings public.company_settings%ROWTYPE;
BEGIN
  IF p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE public_token = p_token;
  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_quote.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_quote.customer_id;
  END IF;

  SELECT * INTO v_settings FROM public.company_settings LIMIT 1;

  RETURN jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'status', v_quote.status,
      'subtotal', v_quote.subtotal,
      'vat_rate', v_quote.vat_rate,
      'vat_amount', v_quote.vat_amount,
      'total', v_quote.total,
      'notes', v_quote.notes,
      'valid_until', v_quote.valid_until,
      'created_at', v_quote.created_at,
      'accepted_by', v_quote.accepted_by,
      'customer_name', v_quote.customer_name,
      'terms_text', v_quote.terms_text,
      'reference_text', v_quote.reference_text,
      'discount_type', v_quote.discount_type,
      'discount_value', v_quote.discount_value
    ),
    'customer', CASE WHEN v_cust.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(COALESCE(v_cust.first_name,'') || ' ' || COALESCE(v_cust.last_name,'')), ''), v_cust.name),
      'company_name', v_cust.company_name,
      'address', v_cust.primary_address_line1,
      'email', v_cust.email,
      'phone', v_cust.phone
    ) END,
    'company', CASE WHEN v_settings.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_name', v_settings.company_name,
      'physical_address', v_settings.physical_address,
      'vat_number', v_settings.vat_number,
      'banking_details', v_settings.banking_details,
      'default_deposit_percentage', v_settings.default_deposit_percentage,
      'default_payment_terms_days', v_settings.default_payment_terms_days
    ) END,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qi.id,
        'item_name', qi.item_name,
        'description', qi.description,
        'quantity', qi.quantity,
        'unit_price', qi.unit_price,
        'total_price', qi.total_price,
        'sort_order', qi.sort_order,
        'product_id', qi.product_id,
        'image_url', sp.image_url
      ) ORDER BY qi.sort_order)
      FROM public.quote_items qi
      LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
      WHERE qi.quote_id = v_quote.id AND qi.parent_item_id IS NULL
    ), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ps.id,
        'section_type', ps.section_type,
        'title', ps.title,
        'content', ps.content,
        'sort_order', ps.sort_order
      ) ORDER BY ps.sort_order)
      FROM public.proposal_sections ps
      WHERE ps.quote_id = v_quote.id
    ), '[]'::jsonb)
  );
END;
$function$;