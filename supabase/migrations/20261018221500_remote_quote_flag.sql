-- R1 remote quotes (Johan 2026-10-18 22:08): quotes made by phone/online carry remote_quote = true.
-- Additive only: existing quotes keep remote_quote = false, so no past quote changes.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS remote_quote boolean NOT NULL DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS remote_quote_source text;
COMMENT ON COLUMN public.quotes.remote_quote IS 'Quote prepared by phone/online without a site visit (Sam, phone Mandy, phone/website lead, or manual toggle). Shows terms section 12.';

CREATE OR REPLACE FUNCTION public.fl_quote_remote_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_src text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- only when a lead is attached for the first time to a draft that was never flagged/unflagged by hand
    IF NEW.lead_id IS NOT DISTINCT FROM OLD.lead_id OR OLD.lead_id IS NOT NULL OR NEW.remote_quote OR NEW.status <> 'draft'
       OR OLD.remote_quote_source IS NOT NULL THEN RETURN NEW; END IF;
  ELSIF NEW.remote_quote THEN
    NEW.remote_quote_source := coalesce(NEW.remote_quote_source, 'manual');
    RETURN NEW;
  END IF;
  IF NEW.lead_id IS NOT NULL THEN
    SELECT CASE l.source::text WHEN 'vapi_call' THEN 'phone_lead' WHEN 'website_form' THEN 'website_lead' END
      INTO v_src FROM public.leads l WHERE l.id = NEW.lead_id;
  END IF;
  IF v_src IS NULL AND TG_OP = 'INSERT' AND coalesce(NEW.reference_text,'') ILIKE 'Phone enquiry%' THEN v_src := 'phone_call'; END IF;
  IF v_src IS NOT NULL THEN NEW.remote_quote := true; NEW.remote_quote_source := v_src; END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS trg_b_quote_remote_flag ON public.quotes;
CREATE TRIGGER trg_b_quote_remote_flag BEFORE INSERT OR UPDATE OF lead_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_remote_flag();

-- client link needs the flag
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
  v_prof public.company_profiles%ROWTYPE;
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

  SELECT * INTO v_settings FROM public.company_settings WHERE company_id = COALESCE(v_quote.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/
  v_settings.default_deposit_percentage := (SELECT default_deposit_percentage FROM public.company_settings WHERE company_id = COALESCE(v_quote.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1); /*acctdep: same row as create_deposit_invoice_for_quote*/

  /* hdr1 2026-10-12: the quote company's own record for header/banking (Johan: details from the record) */
  SELECT * INTO v_prof FROM public.company_profiles WHERE company_id = v_quote.company_id AND archived_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1;

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
      'discount_value', v_quote.discount_value, 'payment_plan', v_quote.payment_plan /*acct1*/, 'remote_quote', v_quote.remote_quote /*rq1*/
    ),
    'customer', CASE WHEN v_cust.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(COALESCE(v_cust.first_name,'') || ' ' || COALESCE(v_cust.last_name,'')), ''), v_cust.name),
      'company_name', v_cust.company_name,
      'address', v_cust.primary_address_line1,
      'email', v_cust.email,
      'phone', v_cust.phone,
      'vat_number', v_cust.vat_number /*cvat1*/
    ) END,
    'company', CASE WHEN v_settings.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_name', v_settings.company_name,
      'physical_address', v_settings.physical_address,
      'vat_number', v_settings.vat_number,
      'banking_details', v_settings.banking_details,
      'default_deposit_percentage', v_settings.default_deposit_percentage,
      'default_payment_terms_days', v_settings.default_payment_terms_days
    ) END,
    'profile', CASE WHEN v_prof.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_id', v_prof.company_id,
      'legal_name', v_prof.legal_name,
      'trading_name', v_prof.trading_name,
      'vat_number', v_prof.vat_number,
      'phone', v_prof.phone,
      'email', v_prof.email,
      'website', v_prof.website,
      'whatsapp', v_prof.whatsapp,
      'address_lines', to_jsonb(v_prof.address_lines),
      'bank_name', v_prof.bank_name,
      'account_name', v_prof.account_name,
      'account_number', v_prof.account_number,
      'branch_code', v_prof.branch_code,
      'account_type', v_prof.account_type,
      'document_style', v_prof.document_style,
      'logo_url', v_prof.logo_url
    ) END,
    'areas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qa.id,
        'name', qa.name,
        'sort_order', qa.sort_order
      ) ORDER BY qa.sort_order NULLS LAST, qa.created_at)
      FROM public.quote_areas qa
      WHERE qa.quote_id = v_quote.id
    ), '[]'::jsonb),
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
        'area_id', qi.area_id,
        'area_name', qa.name,
        'item_type', qi.item_type,
        'image_url', sp.image_url,
        'category', sp.category,
        'brand', sp.brand,
        'btu_rating', sp.btu_rating,
        'capacity_btu', sp.capacity_btu,
        'kw', sp.kw,
        'ai_sales_description', sp.ai_sales_description,
        'item_number', qi.item_number,
        'is_bundle', qi.is_bundle,
        'product_code', sp.product_code
      ) ORDER BY qi.sort_order)
      FROM public.quote_items qi
      LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
      LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id
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
$function$
;
