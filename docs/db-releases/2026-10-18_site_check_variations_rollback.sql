-- Rollback R2 site check (restores original functions, drops everything new)
BEGIN;
CREATE OR REPLACE FUNCTION public.tech_set_job_status(p_job_id uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_mine boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'Invalid status %', p_status; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  v_mine := EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job_id AND a.profile_id = auth.uid()
                      AND COALESCE(a.status,'') <> 'rejected');
  IF NOT v_mine AND NOT (public.is_ops_user(auth.uid()) AND j.company_id = public.get_user_company_id(auth.uid())) THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE = '42501'; END IF;
  IF j.status IN ('completed','cancelled') THEN RETURN j.status; END IF;
  UPDATE public.assignments SET status = p_status,
         started_at = COALESCE(started_at, now()),
         completed_at = CASE WHEN p_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
   WHERE job_id = p_job_id AND profile_id = auth.uid() AND status IS DISTINCT FROM p_status AND COALESCE(status,'') <> 'rejected';
  IF j.status IS DISTINCT FROM p_status THEN
    UPDATE public.jobs SET status = p_status WHERE id = p_job_id;
  END IF;
  RETURN p_status;
END $function$
;
CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    PERFORM public.create_deposit_invoice_for_quote(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.p3_notify_quote_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'accepted' AND lower(COALESCE(OLD.status, '')) <> 'accepted'
     AND NEW.sales_engineer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE quote_id = NEW.id AND job_type = 'installation') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (NEW.sales_engineer_id, 'quote_accepted_handover',
            'Quote ' || COALESCE(NEW.quote_number, '') || ' accepted — hand to technician',
            COALESCE(NEW.customer_name, 'Client') || ' accepted. Open the visit to hand it over.', NEW.id,
            jsonb_build_object('quote_id', NEW.id, 'lead_id', NEW.lead_id,
              'link', CASE WHEN NEW.lead_id IS NOT NULL THEN '/admin/visits/' || NEW.lead_id::text ELSE '/admin/estimates/' || NEW.id::text END));
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_quote_id uuid; v_num text; v_cust text; v_status text;
BEGIN
  SELECT id, quote_number, customer_name, status INTO v_quote_id, v_num, v_cust, v_status
  FROM public.quotes WHERE public_token = p_token FOR UPDATE;
  IF v_quote_id IS NULL THEN RETURN false; END IF;
  IF v_status = 'accepted' THEN RETURN true; END IF; /*oneinv: retry / queued double-submit is not an error*/
  IF v_status NOT IN ('sent','viewed') THEN RETURN false; END IF;
  -- Set BEFORE the update so the on_quote_accepted trigger path is also allowed for the token holder.
  PERFORM set_config('app.public_quote_accept', v_quote_id::text, true);
  UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = p_accepted_by, accepted_signature = p_signature
  WHERE id = v_quote_id;
  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);
  PERFORM set_config('app.public_quote_accept', '', true);
  PERFORM public.qa_notify_rep_and_admins(v_quote_id, 'quote_accepted_client',
    'Quote ' || COALESCE(v_num, '') || ' accepted by client',
    COALESCE(NULLIF(p_accepted_by, ''), v_cust, 'Client') || ' accepted quote ' || COALESCE(v_num, '') || ' online.');
  RETURN true;
END $function$
;
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
DROP TRIGGER IF EXISTS trg_variation_status ON public.quotes;
DROP TRIGGER IF EXISTS trg_quotes_lock_guard ON public.quotes;
DROP TRIGGER IF EXISTS trg_quote_items_lock_guard ON public.quote_items;
DROP FUNCTION IF EXISTS public.get_job_site_check(uuid);
DROP FUNCTION IF EXISTS public.respond_job_variation(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.fl_variation_status_trigger();
DROP FUNCTION IF EXISTS public.finalise_variation_quote(uuid);
DROP FUNCTION IF EXISTS public.submit_site_check(uuid, jsonb, text, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.fl_create_job_variation(uuid, jsonb, jsonb, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.fl_variation_reprice(uuid);
DROP FUNCTION IF EXISTS public.fl_notify_job_techs(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.unlock_quote(uuid, text);
DROP FUNCTION IF EXISTS public.fl_lock_quote(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.fl_quotes_lock_guard();
DROP FUNCTION IF EXISTS public.fl_quote_items_lock_guard();
DROP FUNCTION IF EXISTS public.fl_pipe_rate_code(uuid, uuid);
DROP FUNCTION IF EXISTS public.fl_area_unit(uuid, uuid);
DROP FUNCTION IF EXISTS public.fl_job_needs_site_check(uuid);
DROP FUNCTION IF EXISTS public.fl_quote_has_install(uuid);
DROP TABLE IF EXISTS public.quote_lock_events;
DROP TABLE IF EXISTS public.job_variations;
DROP TABLE IF EXISTS public.job_site_checks;
DROP TABLE IF EXISTS public.variation_settings;
DROP TABLE IF EXISTS public.variation_rates;
DROP FUNCTION IF EXISTS public.fl_can_see_job(uuid, uuid);
DROP FUNCTION IF EXISTS public.fl_is_company_office(uuid, uuid);
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_site_check_status_check;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS variation_quote_id, DROP COLUMN IF EXISTS site_check_status;
-- Variation quotes created while live stay as ordinary quotes (is_variation column dropped). Review them before rollback.
ALTER TABLE public.quotes DROP COLUMN IF EXISTS variation_summary, DROP COLUMN IF EXISTS locked_reason, DROP COLUMN IF EXISTS locked_by,
  DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS variation_job_id, DROP COLUMN IF EXISTS is_variation, DROP COLUMN IF EXISTS parent_quote_id;
COMMIT;
