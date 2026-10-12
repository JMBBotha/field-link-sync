-- Invoicing release 1 (DB), 12 Oct 2026. Rollback: 2026-10-12_invoicing_r1_rollback.sql
-- Additive only: company profiles per issuing company, per-line 15% VAT (enforced), deposit request,
-- client VAT under Billed To, discount saved, per-company numbers, lock once sent, duplicate,
-- primary company_settings row (no cross-company "nearest row" fallback). Existing invoice totals untouched.

CREATE SCHEMA IF NOT EXISTS backup_inv_20261012;
CREATE TABLE IF NOT EXISTS backup_inv_20261012.invoices AS SELECT * FROM public.invoices;
CREATE TABLE IF NOT EXISTS backup_inv_20261012.invoice_items AS SELECT * FROM public.invoice_items;
CREATE TABLE IF NOT EXISTS backup_inv_20261012.company_settings AS SELECT * FROM public.company_settings;

-- 1. Primary settings row per company (replaces "newest row of any company")
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
UPDATE public.company_settings cs SET is_primary = true
 WHERE cs.id = (SELECT s.id FROM public.company_settings s WHERE s.company_id = cs.company_id
                ORDER BY s.updated_at DESC NULLS LAST, s.id LIMIT 1);
CREATE UNIQUE INDEX IF NOT EXISTS company_settings_one_primary ON public.company_settings(company_id) WHERE is_primary;

-- 2. Company profiles (issuing companies: Massair CT, Massair Ind CC) inside a tenant
CREATE TABLE IF NOT EXISTS public.company_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  trading_name text,
  vat_number text,
  phone text, email text, website text, whatsapp text,
  address_lines text[] NOT NULL DEFAULT '{}',
  bank_name text, account_name text, account_number text, branch_code text, account_type text,
  terms_text text,           -- NULL = standard terms, filled with this profile's name + banking
  invoice_prefix text NOT NULL DEFAULT 'INV-',
  use_shared_sequence boolean NOT NULL DEFAULT false,  -- true = old INV-### series (generate_invoice_number)
  next_invoice_no integer NOT NULL DEFAULT 1,
  number_pad integer NOT NULL DEFAULT 4,
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_profiles_one_default ON public.company_profiles(company_id) WHERE is_default AND archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_profiles_prefix ON public.company_profiles(company_id, invoice_prefix) WHERE archived_at IS NULL;
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cp_select ON public.company_profiles;
CREATE POLICY cp_select ON public.company_profiles FOR SELECT TO authenticated
  USING (public.p4_co_ok(company_id) AND NOT public.is_field_tech_only(auth.uid()));
DROP POLICY IF EXISTS cp_insert ON public.company_profiles;
CREATE POLICY cp_insert ON public.company_profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND public.p4_co_ok(company_id));
DROP POLICY IF EXISTS cp_update ON public.company_profiles;
CREATE POLICY cp_update ON public.company_profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND public.p4_co_ok(company_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND public.p4_co_ok(company_id));

-- Seed: CT = exactly what live documents print today (name, VAT shown today, banking from the row in use).
-- VAT numbers are editable data, not code. 4630313080 is UNCONFIRMED (Johan to decide).
INSERT INTO public.company_profiles (company_id, legal_name, trading_name, vat_number, phone, email, website, whatsapp, address_lines,
  bank_name, account_name, account_number, branch_code, account_type, invoice_prefix, use_shared_sequence, is_default)
SELECT 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', 'MASSAIR CT (PTY) Ltd', '0800-BE-COOL AC Super Service', '4630313080',
  '(021) 802-2889', 'info@0800becool.co.za', 'www.0800becool.co.za', '069 683 8624',
  ARRAY['9A Cabernet Rd, Blackheath Ind','Cape Town','7580'],
  'FNB', 'MASSAIR CT (PTY) Ltd', '63226563591', '250 655', 'Cheque', 'INV-', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.company_profiles WHERE company_id='d9b494c7-cdb2-4e86-b4e9-8860c3519dbd' AND legal_name ILIKE 'MASSAIR CT%');
INSERT INTO public.company_profiles (company_id, legal_name, trading_name, vat_number, phone, email, website, whatsapp, address_lines,
  bank_name, account_name, account_number, branch_code, account_type, invoice_prefix, use_shared_sequence, next_invoice_no, is_default)
SELECT 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', 'MASSAIR IND CC', '0800-BE-COOL AC Super Service', NULL,
  '(021) 802-2889', 'info@0800becool.co.za', 'www.0800becool.co.za', '069 683 8624',
  ARRAY['9A Cabernet Rd, Blackheath Ind','Cape Town','7580'],
  'FNB', 'MASSAIR IND CC', '62326769075', '250 655', 'Cheque', 'IND-', false, 1, false
WHERE NOT EXISTS (SELECT 1 FROM public.company_profiles WHERE company_id='d9b494c7-cdb2-4e86-b4e9-8860c3519dbd' AND legal_name ILIKE 'MASSAIR IND%');

-- 3. Invoice header columns
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS company_profile_id uuid REFERENCES public.company_profiles(id),
  ADD COLUMN IF NOT EXISTS billed_to_vat_number text,
  ADD COLUMN IF NOT EXISTS discount_type text CHECK (discount_type IN ('percent','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value numeric,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_type text CHECK (deposit_type IN ('percent','fixed')),
  ADD COLUMN IF NOT EXISTS deposit_value numeric,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS duplicated_from uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

-- 4. Line columns: name, type, room, order, VAT 15% enforced on every line
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS line_name text,
  ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'item' CHECK (line_type IN ('item','unit','installation','labour','deposit','other')),
  ADD COLUMN IF NOT EXISTS room_label text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 15;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_vat_15;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_vat_15 CHECK (vat_rate = 15);
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS vat_amount numeric GENERATED ALWAYS AS (round(amount * vat_rate / 100, 2)) STORED;

-- 5. Helpers
CREATE OR REPLACE FUNCTION public.default_company_profile(p_company uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT id FROM public.company_profiles WHERE company_id = p_company AND is_default AND archived_at IS NULL LIMIT 1
$f$;

CREATE OR REPLACE FUNCTION public.company_profile_snapshot(p_profile uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT to_jsonb(p) - 'next_invoice_no' - 'created_at' - 'updated_at' FROM public.company_profiles p WHERE p.id = p_profile
$f$;

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_profile uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE p public.company_profiles%ROWTYPE; v_no integer; v_num text;
BEGIN
  SELECT * INTO p FROM public.company_profiles WHERE id = p_profile AND archived_at IS NULL FOR UPDATE;
  IF p.id IS NULL THEN RETURN public.generate_invoice_number(); END IF;
  IF auth.uid() IS NOT NULL AND (NOT public.p4_co_ok(p.company_id) OR public.is_field_tech_only(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized for this company' USING ERRCODE = '42501'; END IF;
  IF p.use_shared_sequence THEN RETURN public.generate_invoice_number(); END IF;
  LOOP
    v_no := p.next_invoice_no;
    UPDATE public.company_profiles SET next_invoice_no = v_no + 1, updated_at = now() WHERE id = p.id RETURNING next_invoice_no INTO p.next_invoice_no;
    v_num := p.invoice_prefix || lpad(v_no::text, p.number_pad, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invoices WHERE invoice_number = v_num);
  END LOOP;
  RETURN v_num;
END $f$;
REVOKE ALL ON FUNCTION public.next_invoice_number(uuid) FROM anon;

-- 6. Invoice guard: default profile, client VAT, deposit maths (on VAT-incl total), lock once sent, snapshot
CREATE OR REPLACE FUNCTION public.trg_invoice_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_unlock boolean := COALESCE(current_setting('app.invoice_unlock', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.company_profile_id IS NULL AND NEW.company_id IS NOT NULL THEN
      NEW.company_profile_id := public.default_company_profile(NEW.company_id);
    END IF;
    IF NEW.billed_to_vat_number IS NULL AND NEW.customer_id IS NOT NULL THEN
      SELECT NULLIF(btrim(vat_number), '') INTO NEW.billed_to_vat_number FROM public.customers WHERE id = NEW.customer_id;
    END IF;
  END IF;
  IF NEW.company_profile_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.company_profiles cp WHERE cp.id = NEW.company_profile_id AND cp.company_id IS NOT DISTINCT FROM NEW.company_id) THEN
    RAISE EXCEPTION 'Company profile belongs to another company' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft' AND NOT v_unlock THEN
    IF NEW.status = 'draft' THEN RAISE EXCEPTION 'Invoice % is already %, it cannot go back to draft (duplicate it instead)', OLD.invoice_number, OLD.status; END IF;
    IF (NEW.invoice_number, NEW.customer_name, NEW.customer_phone, NEW.customer_address, NEW.customer_email, NEW.customer_id,
        NEW.line_items, NEW.subtotal, NEW.tax_rate, NEW.tax_amount, NEW.grand_total, NEW.issue_date,
        NEW.discount_type, NEW.discount_value, NEW.discount_amount, NEW.company_profile_id, NEW.billed_to_vat_number, NEW.company_id)
       IS DISTINCT FROM
       (OLD.invoice_number, OLD.customer_name, OLD.customer_phone, OLD.customer_address, OLD.customer_email, OLD.customer_id,
        OLD.line_items, OLD.subtotal, OLD.tax_rate, OLD.tax_amount, OLD.grand_total, OLD.issue_date,
        OLD.discount_type, OLD.discount_value, OLD.discount_amount, OLD.company_profile_id, OLD.billed_to_vat_number, OLD.company_id) THEN
      RAISE EXCEPTION 'Invoice % is % and locked. Duplicate it or use a credit note to change it.', OLD.invoice_number, OLD.status
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Deposit request: % of the VAT-inclusive total, or a fixed amount
  IF NEW.deposit_type IS NULL THEN
    NEW.deposit_value := NULL; NEW.deposit_amount := NULL;
  ELSIF NEW.deposit_type = 'percent' THEN
    IF NEW.deposit_value IS NULL OR NEW.deposit_value <= 0 OR NEW.deposit_value > 100 THEN
      RAISE EXCEPTION 'Deposit %% must be between 0 and 100'; END IF;
    NEW.deposit_amount := round(COALESCE(NEW.grand_total, 0) * NEW.deposit_value / 100, 2);
  ELSE
    IF NEW.deposit_value IS NULL OR NEW.deposit_value <= 0 OR NEW.deposit_value > COALESCE(NEW.grand_total, 0) + 0.005 THEN
      RAISE EXCEPTION 'Deposit amount must be more than 0 and not more than the invoice total'; END IF;
    NEW.deposit_amount := round(NEW.deposit_value, 2);
  END IF;

  IF NEW.status IS DISTINCT FROM 'draft' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    NEW.sent_at := COALESCE(NEW.sent_at, now());
    IF NEW.company_profile_id IS NOT NULL THEN
      NEW.profile_snapshot := public.company_profile_snapshot(NEW.company_profile_id);
    END IF;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_invoice_guard ON public.invoices;
CREATE TRIGGER trg_invoice_guard BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_guard();

-- 7. Lines locked once the invoice is not a draft
CREATE OR REPLACE FUNCTION public.trg_invoice_items_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_status text; v_num text;
BEGIN
  IF COALESCE(current_setting('app.invoice_unlock', true), '') = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status, invoice_number INTO v_status, v_num FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice % is % and locked. Duplicate it or use a credit note to change it.', v_num, v_status USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $f$;
DROP TRIGGER IF EXISTS trg_invoice_items_lock ON public.invoice_items;
CREATE TRIGGER trg_invoice_items_lock BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_items_lock();

-- 8. Duplicate an invoice (repeat house jobs): new DRAFT, new number, same company profile, no payments
CREATE OR REPLACE FUNCTION public.duplicate_invoice(p_invoice uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE s public.invoices%ROWTYPE; v_id uuid; v_num text; v_days integer;
BEGIN
  SELECT * INTO s FROM public.invoices WHERE id = p_invoice;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF auth.uid() IS NOT NULL AND (NOT public.p4_co_ok(s.company_id) OR public.is_field_tech_only(auth.uid())
       OR NOT (public.has_role(auth.uid(), 'admin'::app_role) OR s.agent_id = auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized for this invoice' USING ERRCODE = '42501'; END IF;
  v_num := public.next_invoice_number(COALESCE(s.company_profile_id, public.default_company_profile(s.company_id)));
  SELECT default_payment_terms_days INTO v_days FROM public.company_settings WHERE company_id = s.company_id ORDER BY is_primary DESC LIMIT 1;
  INSERT INTO public.invoices (invoice_number, lead_id, agent_id, customer_name, customer_phone, customer_address, customer_email, customer_id,
    line_items, subtotal, tax_rate, tax_amount, grand_total, notes, status, issue_date, due_date, company_id, location_id,
    company_profile_id, billed_to_vat_number, discount_type, discount_value, discount_amount, deposit_type, deposit_value, duplicated_from)
  VALUES (v_num, s.lead_id, COALESCE(auth.uid(), s.agent_id), s.customer_name, s.customer_phone, s.customer_address, s.customer_email, s.customer_id,
    s.line_items, s.subtotal, CASE WHEN s.tax_rate <= 1 THEN 15 ELSE s.tax_rate END, s.tax_amount, s.grand_total, s.notes, 'draft', CURRENT_DATE,
    CURRENT_DATE + COALESCE(v_days, 30), s.company_id, s.location_id,
    s.company_profile_id, s.billed_to_vat_number, s.discount_type, s.discount_value, s.discount_amount, s.deposit_type, s.deposit_value, s.id)
  RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, service_id, description, quantity, unit_price, amount, line_name, line_type, room_label, sort_order, vat_rate)
  SELECT v_id, service_id, description, quantity, unit_price, amount, line_name, line_type, room_label, sort_order, 15
    FROM public.invoice_items WHERE invoice_id = s.id ORDER BY sort_order, created_at;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.duplicate_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.duplicate_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated;

-- 9. Backfill existing invoices: profile + snapshot only (totals untouched)
SELECT set_config('app.invoice_unlock', 'on', true);
UPDATE public.invoices i SET company_profile_id = public.default_company_profile(i.company_id)
 WHERE company_profile_id IS NULL AND company_id IS NOT NULL AND public.default_company_profile(i.company_id) IS NOT NULL;
UPDATE public.invoices SET profile_snapshot = public.company_profile_snapshot(company_profile_id), sent_at = COALESCE(sent_at, issue_date::timestamptz)
 WHERE status <> 'draft' AND company_profile_id IS NOT NULL AND profile_snapshot IS NULL;
SELECT set_config('app.invoice_unlock', '', true);
CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  q public.quotes%ROWTYPE;
  cust record;
  v_existing uuid;
  v_pct numeric; v_frac numeric; v_number text;
  v_subtotal numeric; v_vat numeric; v_total numeric; v_rate numeric;
  v_agent uuid; v_id uuid;
  v_email text;
BEGIN
  PERFORM public.rh_assert(false); /*rh1*/
  PERFORM pg_advisory_xact_lock(hashtextextended('deposit_invoice:' || p_quote_id::text, 0));

  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL OR q.status = 'declined' THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL AND COALESCE(q.company_id, (SELECT c.id FROM public.companies c WHERE c.is_master ORDER BY c.created_at LIMIT 1)) IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not authorized for this quote' USING ERRCODE = '42501'; END IF; /*xco*/

  SELECT id INTO v_existing FROM public.invoices WHERE quote_id = q.id ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(default_deposit_percentage, 70) INTO v_pct
  FROM public.company_settings WHERE company_id = COALESCE(q.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*inv1: no cross-company fallback*/ /*p4cs*/
  v_pct := COALESCE(v_pct, 70);
  IF v_pct <= 0 OR v_pct > 100 THEN v_pct := 70; END IF;
  IF public.payment_plan_ok(q.payment_plan) AND q.payment_plan IS NOT NULL THEN v_pct := (q.payment_plan->'stages'->0->>'pct')::numeric; END IF; /*acct1*/
  v_frac := v_pct / 100.0;

  v_subtotal := ROUND(COALESCE(q.subtotal, 0) * v_frac, 2);
  v_vat := ROUND(COALESCE(q.vat_amount, 0) * v_frac, 2);
  v_total := ROUND(COALESCE(q.total, 0) * v_frac, 2);
  v_rate := COALESCE(q.vat_rate, 0.15);
  IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;

  SELECT name, phone, email, address INTO cust FROM public.customers WHERE id = q.customer_id;
  v_agent := COALESCE(q.sales_engineer_id, q.created_by, auth.uid());
  IF v_agent IS NULL THEN RETURN NULL; END IF;

  v_number := public.generate_invoice_number();

  INSERT INTO public.invoices (
    quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    invoice_number, subtotal, tax_rate, tax_amount, grand_total,
    due_date, status, line_items, company_id, notes
  ) VALUES (
    q.id, q.lead_id, v_agent, q.customer_id,
    COALESCE(cust.name, q.customer_name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
    v_number, v_subtotal, v_rate, v_vat, v_total,
    CURRENT_DATE + 30, 'draft',
    jsonb_build_array(jsonb_build_object(
      'description', 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
      'quantity', 1, 'rate', v_subtotal, 'amount', v_subtotal)),
    q.company_id,
    'DEPOSIT — ' || ROUND(v_pct)::text || '% of quote ' || COALESCE(q.quote_number, '') || '. Balance invoiced on completion.'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
  VALUES (v_id, 'Deposit (' || ROUND(v_pct)::text || '%) — quote ' || COALESCE(q.quote_number, ''),
    1, v_subtotal, v_subtotal);

  -- Auto-send (insert branch only)
  v_email := NULLIF(trim(COALESCE(cust.email, '')), '');
  IF v_email IS NOT NULL THEN
    PERFORM set_config('app.invoice_send_trigger', 'accept_auto', true);
    UPDATE public.invoices
       SET status = 'sent', issue_date = COALESCE(issue_date, CURRENT_DATE)
     WHERE id = v_id;
    PERFORM set_config('app.invoice_send_trigger', '', true);
  ELSE
    INSERT INTO public.email_events (email_id, event_type, recipient_email, quote_number, event_data)
    VALUES (gen_random_uuid()::text, 'invoice_email_skipped_no_email', '', q.quote_number,
      jsonb_build_object('invoice_id', v_id, 'invoice_number', v_number, 'trigger', 'accept_auto'));

    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    SELECT u, 'deposit_invoice_not_emailed', 'Deposit invoice not emailed — no client email',
      'Invoice ' || v_number || ' for quote ' || COALESCE(q.quote_number, '') || ' was not emailed because the client has no email address. Share the pay link by WhatsApp or copy.',
      v_id, jsonb_build_object('invoice_id', v_id, 'quote_id', q.id)
    FROM (
      SELECT q.sales_engineer_id AS u WHERE q.sales_engineer_id IS NOT NULL
      UNION
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE q.sales_engineer_id IS NULL AND ur.role = 'admin' AND p.company_id = q.company_id
    ) t;
  END IF;

  RETURN v_id;
END;
$function$;

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

  SELECT * INTO v_settings FROM public.company_settings WHERE company_id = COALESCE(v_quote.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/
  v_settings.default_deposit_percentage := (SELECT default_deposit_percentage FROM public.company_settings WHERE company_id = COALESCE(v_quote.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1); /*acctdep: same row as create_deposit_invoice_for_quote*/

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
      'discount_value', v_quote.discount_value, 'payment_plan', v_quote.payment_plan /*acct1*/
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

CREATE OR REPLACE FUNCTION public._customer_statement_build(p_customer uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.customers%ROWTYPE; v_open numeric; v_rows jsonb; v_close numeric; s record;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  WITH inv AS (
    SELECT i.* FROM public.invoices i
    WHERE i.company_id IS NOT DISTINCT FROM c.company_id
      AND (i.customer_id = c.id OR (i.customer_id IS NULL AND lower(btrim(i.customer_name)) = lower(btrim(c.name))))
      AND COALESCE(i.status, 'draft') NOT IN ('draft', 'void', 'cancelled')
  ), tx AS (
    SELECT COALESCE(i.issue_date, i.created_at::date) d, 1 k, 'invoice' t, i.invoice_number ref,
           COALESCE(NULLIF(i.line_items->0->>'description', ''), 'Invoice') descr, COALESCE(i.grand_total, 0) debit, 0::numeric credit, i.id inv_id, i.created_at ts
      FROM inv i
    UNION ALL
    SELECT COALESCE(p.payment_date::date, p.created_at::date), 2, 'payment', inv.invoice_number,
           'Payment' || COALESCE(' (' || NULLIF(p.method, '') || ')', ''), 0, COALESCE(p.amount, 0), inv.id, p.created_at
      FROM public.payments p JOIN inv ON inv.id = p.invoice_id
     WHERE p.status IN ('paid', 'succeeded', 'completed')
    UNION ALL
    SELECT cn.issue_date, 3, 'credit_note', cn.credit_note_number,
           'Credit note on ' || inv.invoice_number || COALESCE(' — ' || NULLIF(cn.description, ''), ''), 0, cn.total, inv.id, cn.created_at
      FROM public.credit_notes cn JOIN inv ON inv.id = cn.invoice_id
     WHERE cn.status = 'issued'
  ), ord AS (
    SELECT tx.*, SUM(debit - credit) OVER (ORDER BY d, k, ts, ref ROWS UNBOUNDED PRECEDING) run FROM tx
  )
  SELECT COALESCE((SELECT SUM(debit - credit) FROM tx WHERE d < p_from), 0),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'type', t, 'ref', ref, 'description', descr, 'debit', debit, 'credit', credit, 'balance', ROUND(run, 2), 'invoice_id', inv_id) ORDER BY d, k, ts, ref) FROM ord WHERE d BETWEEN p_from AND p_to), '[]'::jsonb),
         COALESCE((SELECT SUM(debit - credit) FROM tx WHERE d <= p_to), 0)
    INTO v_open, v_rows, v_close;
  SELECT company_name, physical_address, vat_number, banking_details INTO s FROM public.company_settings
   WHERE company_id = COALESCE(c.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*inv1*/
  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', COALESCE(NULLIF(btrim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), c.name),
      'company_name', c.company_name, 'address', COALESCE(c.primary_address_line1, c.address), 'vat_number', c.vat_number),
    'company', jsonb_build_object('company_name', s.company_name, 'physical_address', s.physical_address, 'vat_number', s.vat_number, 'banking_details', s.banking_details),
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'opening_balance', ROUND(v_open, 2), 'closing_balance', ROUND(v_close, 2), 'rows', v_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.company_profile_safe()
 RETURNS TABLE(company_id uuid, company_name text, vat_number text, physical_address text, postal_address text, office_address text, logo_storage_path text, logo_url text, default_deposit_percentage numeric, default_payment_terms_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, COALESCE(NULLIF(cs.company_name,''), c.name), cs.vat_number, cs.physical_address, cs.postal_address,
         c.office_address, cs.logo_storage_path, c.logo_url,
         cs.default_deposit_percentage::numeric, cs.default_payment_terms_days::integer
  FROM public.profiles p
  JOIN public.companies c ON c.id = p.company_id
  LEFT JOIN LATERAL (SELECT * FROM public.company_settings s WHERE s.company_id = c.id
                     ORDER BY s.is_primary DESC, s.updated_at DESC LIMIT 1) cs ON true
  WHERE p.id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.approve_invoice_request(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); r public.invoice_requests%ROWTYPE; l public.leads%ROWTYPE; v_inv uuid; inv public.invoices%ROWTYPE;
  e jsonb; v_price numeric; v_qty numeric; v_desc text; v_rate numeric; v_sub numeric; v_lines jsonb := '[]'::jsonb; v_hr numeric;
BEGIN
  IF v_uid IS NULL OR public.is_field_tech_only(v_uid) OR public.is_sales_rep(v_uid)
     OR NOT (public.has_role(v_uid,'admin'::app_role) OR public.has_role(v_uid,'dispatcher'::app_role)) THEN
    RAISE EXCEPTION 'Only the office can approve invoice requests';
  END IF;
  SELECT * INTO r FROM public.invoice_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT public.p4_co_ok(r.company_id) THEN RAISE EXCEPTION 'Invoice request not found'; END IF;
  IF r.status = 'approved' THEN RETURN r.invoice_id; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request was dismissed'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = r.lead_id;

  IF r.quote_id IS NOT NULL THEN v_inv := public._create_balance_invoice(r.quote_id); END IF;
  IF v_inv IS NULL THEN
    SELECT i.id INTO v_inv FROM public.invoices i
     WHERE (i.lead_id = r.lead_id OR (r.quote_id IS NOT NULL AND i.quote_id = r.quote_id))
       AND COALESCE(i.status,'') NOT IN ('void','cancelled') AND COALESCE(i.notes,'') NOT LIKE 'DEPOSIT%'
     ORDER BY (i.status = 'draft') DESC, i.created_at DESC LIMIT 1;
  END IF;
  IF v_inv IS NULL THEN
    INSERT INTO public.invoices (lead_id, quote_id, agent_id, customer_id, customer_name, customer_phone, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total, due_date, status, line_items, company_id, notes)
    VALUES (l.id, r.quote_id, v_uid, l.customer_id, COALESCE(l.customer_name,''), COALESCE(l.customer_phone,''), l.customer_address,
      public.generate_invoice_number(), 0, 15, 0, 0, CURRENT_DATE + 30, 'draft', '[]'::jsonb, r.company_id,
      'From invoice request (' || CASE WHEN r.as_quoted THEN 'as quoted' ELSE 'changes' END || ')')
    RETURNING id INTO v_inv;
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = v_inv;

  IF NOT r.as_quoted THEN
    IF inv.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is already %, add the extras manually (or credit/re-issue)', inv.invoice_number, inv.status;
    END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(r.extra_items) LOOP
      v_qty := COALESCE((e->>'qty')::numeric, 0);
      CONTINUE WHEN v_qty <= 0;
      v_price := NULL;
      IF e->>'product_id' IS NOT NULL THEN
        SELECT o.sell_excl_vat INTO v_price FROM public.get_product_sell_options() o WHERE o.id = (e->>'product_id')::uuid;
      END IF;
      v_desc := 'Extra (tech): ' || COALESCE(e->>'name','Item') || CASE WHEN v_price IS NULL THEN ' – price needed' ELSE '' END;
      v_price := COALESCE(v_price, 0);
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_inv, v_desc, v_qty, v_price, round(v_qty * v_price, 2));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', v_qty, 'rate', v_price, 'amount', round(v_qty * v_price, 2)));
    END LOOP;
    IF r.extra_hours IS NOT NULL AND r.extra_hours > 0 THEN
      SELECT cs.default_hourly_rate INTO v_hr FROM public.company_settings cs WHERE cs.company_id = r.company_id
        ORDER BY cs.is_primary DESC, cs.created_at DESC NULLS LAST LIMIT 1;
      v_hr := COALESCE(v_hr, 0);
      v_desc := 'Extra labour (tech): ' || r.extra_hours || ' h' || CASE WHEN v_hr = 0 THEN ' – rate needed' ELSE '' END;
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (v_inv, v_desc, r.extra_hours, v_hr, round(r.extra_hours * v_hr, 2));
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'quantity', r.extra_hours, 'rate', v_hr, 'amount', round(r.extra_hours * v_hr, 2)));
    END IF;
    v_rate := COALESCE(inv.tax_rate, 15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_sub FROM public.invoice_items WHERE invoice_id = v_inv;
    UPDATE public.invoices SET line_items = COALESCE(line_items, '[]'::jsonb) || v_lines,
      subtotal = round(v_sub, 2), tax_amount = round(v_sub * v_rate / 100, 2), grand_total = round(v_sub * (1 + v_rate / 100), 2),
      notes = concat_ws(E'\n', notes, 'Tech extras added from invoice request ' || to_char(now(), 'YYYY-MM-DD') || ' – review prices before sending.'),
      updated_at = now()
    WHERE id = v_inv;
  END IF;

  UPDATE public.invoice_requests SET status = 'approved', invoice_id = v_inv, approved_by = v_uid, approved_at = now(), updated_at = now()
   WHERE id = r.id;
  RETURN v_inv;
END $function$;
