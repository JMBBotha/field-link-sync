-- 28 Oct 2026 (Johan pt1867u 'Ok'): ONE company-wide T&C managed by the main admin + 'Existing / relocated units' clause.
-- Additive. Backup: /workspace/terms-2026-10-28/backup/. Rollback: supabase/rollbacks/20261028200000_company_terms_rollback.sql
CREATE TABLE IF NOT EXISTS public.company_terms (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  relocation_clause text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ct_read ON public.company_terms;
CREATE POLICY ct_read ON public.company_terms FOR SELECT TO anon, authenticated USING (true);  -- public legal wording, no personal data
DROP POLICY IF EXISTS ct_admin_write ON public.company_terms;
CREATE POLICY ct_admin_write ON public.company_terms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()) AND company_id = public.fl_master_company_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_master_company_user(auth.uid()) AND company_id = public.fl_master_company_id());
GRANT SELECT ON public.company_terms TO anon, authenticated;
GRANT INSERT, UPDATE ON public.company_terms TO authenticated;
INSERT INTO public.company_terms (company_id, relocation_clause)
SELECT public.fl_master_company_id(), $cl$This quote includes removing and relocating existing air conditioning units. The age, condition and internal state of these units, including compressors, electronics and other components, are unknown to us. Massair CT (Pty) Ltd will take the utmost care and follow correct procedures when removing, relocating, servicing and recommissioning them, but we cannot guarantee their condition, functionality or performance. Should any existing unit fail or not function correctly after relocation, whether immediately or at a later stage, this is not the responsibility of Massair CT (Pty) Ltd and the risk remains with the client. Any repairs or replacement parts required on existing units will be quoted separately.$cl$
WHERE public.fl_master_company_id() IS NOT NULL
ON CONFLICT (company_id) DO NOTHING;

-- Per-quote switch: NULL = auto-detect, 'on' / 'off' = admin override.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS relocation_clause text;
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_relocation_clause_chk;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_relocation_clause_chk CHECK (relocation_clause IS NULL OR relocation_clause IN ('on','off'));

-- Only admins may set per-quote terms text or the clause switch.
CREATE OR REPLACE FUNCTION public.fl_quote_terms_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.terms_text := NULL; NEW.relocation_clause := NULL;
  ELSIF NEW.terms_text IS DISTINCT FROM OLD.terms_text OR NEW.relocation_clause IS DISTINCT FROM OLD.relocation_clause THEN
    RAISE EXCEPTION 'Terms and conditions are company-wide and can only be changed by an admin' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_quote_terms_guard ON public.quotes;
CREATE TRIGGER trg_quote_terms_guard BEFORE INSERT OR UPDATE OF terms_text, relocation_clause ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_terms_guard();

-- Existing quotes: drafts follow the company set; everything already sent/viewed/accepted/closed is frozen without the clause.
SET LOCAL app.quote_lock_bypass = 'on';
UPDATE public.quotes SET terms_text = NULL WHERE status::text = 'draft' AND terms_text IS NOT NULL;
UPDATE public.quotes SET relocation_clause = 'off' WHERE status::text <> 'draft' AND relocation_clause IS NULL;
-- Templates no longer carry terms.
UPDATE public.quote_templates SET terms_text = NULL WHERE terms_text IS NOT NULL;

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
      'discount_value', v_quote.discount_value, 'payment_plan', v_quote.payment_plan /*acct1*/, 'remote_quote', v_quote.remote_quote /*rq1*/, 'remote_quote_source', v_quote.remote_quote_source /*shop1*/, 'relocation_clause', v_quote.relocation_clause, 'relocation_text', (SELECT ct.relocation_clause FROM public.company_terms ct WHERE ct.company_id = public.fl_master_company_id()) /*tc1*/, 'is_variation', v_quote.is_variation, 'variation_summary', v_quote.variation_summary, 'locked_at', v_quote.locked_at, 'parent_total', (SELECT pq.total FROM public.quotes pq WHERE pq.id = v_quote.parent_quote_id), 'parent_quote_number', (SELECT pq.quote_number FROM public.quotes pq WHERE pq.id = v_quote.parent_quote_id) /*r2*/
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
$function$;
