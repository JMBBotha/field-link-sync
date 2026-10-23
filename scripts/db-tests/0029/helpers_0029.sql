-- 0029 extras: live bodies (read 23 Oct 2026) of functions 0029 replaces or depends on, plus stubs and live triggers.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public._client_contact_fill_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record;
begin
  if new.customer_id is null then return new; end if;
  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), name) as nm, email, phone,
         coalesce(nullif(concat_ws(', ', nullif(primary_address_line1,''), nullif(primary_address_line2,''), nullif(city,''), nullif(postal_code,'')), ''), address) as addr
    into c from public.customers where id = new.customer_id;
  if not found then return new; end if;
  new.customer_name := coalesce(nullif(c.nm,''), new.customer_name);
  new.customer_email := coalesce(nullif(c.email,''), new.customer_email);
  new.customer_phone := coalesce(nullif(c.phone,''), new.customer_phone);
  new.customer_address := coalesce(nullif(c.addr,''), new.customer_address);
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public._client_contact_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.invoices set customer_id = customer_id
   where customer_id = new.id and coalesce(status,'') not in ('paid','void','cancelled');
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_user_company_id(_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT company_id FROM public.profiles WHERE id = _user_id
$function$
;

CREATE OR REPLACE FUNCTION public.is_field_tech_only(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL
    AND (public.has_role(_uid, 'field_agent'::app_role)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.dispatch_role = 'technician'))
    AND NOT public.is_ops_user(_uid)
    AND NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = _uid AND cm.role = 'admin');
$function$
;

CREATE OR REPLACE FUNCTION public.is_ops_user(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','dispatcher','platform_super_admin','platform_ops')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_sales_rep(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL
    AND public.has_role(_uid, 'dispatcher'::app_role)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.dispatch_role IN ('sales','sales_engineer'))
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin','platform_super_admin','platform_ops'))
    AND NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = _uid AND cm.role = 'admin');
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_quote_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote_id uuid;
  v_subtotal numeric;
  v_rate numeric;
  v_discount_type text;
  v_discount_value numeric;
  v_discount_amount numeric;
BEGIN
  v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);
  IF v_quote_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_price, quantity * unit_price)), 0)
    INTO v_subtotal
    FROM public.quote_items
   WHERE quote_id = v_quote_id
     AND parent_item_id IS NULL;

  SELECT COALESCE(vat_rate, 0.15), discount_type, COALESCE(discount_value, 0)
    INTO v_rate, v_discount_type, v_discount_value
    FROM public.quotes
   WHERE id = v_quote_id;

  IF v_discount_type IN ('percent', 'percentage') THEN
    v_discount_amount := v_subtotal * (v_discount_value / 100.0);
  ELSIF v_discount_type = 'fixed' THEN
    v_discount_amount := v_discount_value;
  ELSE
    v_discount_amount := 0;
  END IF;

  UPDATE public.quotes
     SET subtotal   = v_subtotal,
         vat_amount = ROUND((v_subtotal - v_discount_amount) * v_rate, 2),
         total      = ROUND((v_subtotal - v_discount_amount) * (1 + v_rate), 2),
         updated_at = now()
   WHERE id = v_quote_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_invoice_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_unlock boolean := COALESCE(current_setting('app.invoice_unlock', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' AND NEW.quote_id IS NOT NULL AND auth.uid() IS NOT NULL AND public.is_sales_rep(auth.uid())
     AND COALESCE(current_setting('app.public_quote_accept', true), '') IS DISTINCT FROM NEW.quote_id::text
     AND EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.id = NEW.quote_id AND qq.status IS DISTINCT FROM 'accepted') THEN
    RAISE EXCEPTION 'Only the office can invoice a quote the client has not accepted' USING ERRCODE = '42501'; /*cag2*/
  END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_quote_id uuid; v_num text; v_cust text; v_status text; v_who text; v_appr uuid;
BEGIN
  SELECT id, quote_number, customer_name, status INTO v_quote_id, v_num, v_cust, v_status
  FROM public.quotes WHERE public_token = p_token FOR UPDATE;
  IF v_quote_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote_id AND is_variation) THEN RETURN false; END IF; /*r2: use respond_job_variation*/
  IF v_status = 'accepted' THEN RETURN true; END IF; /*oneinv: retry / queued double-submit is not an error*/
  IF v_status NOT IN ('sent','viewed') THEN RETURN false; END IF;
  -- Set BEFORE the update so the on_quote_accepted trigger path is also allowed for the token holder.
  PERFORM set_config('app.public_quote_accept', v_quote_id::text, true);
  UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = p_accepted_by, accepted_signature = p_signature
  WHERE id = v_quote_id;
  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);
  PERFORM set_config('app.public_quote_accept', '', true);
  v_who := COALESCE(NULLIF(btrim(p_accepted_by), ''), v_cust, 'Client');
  SELECT a.id INTO v_appr FROM public.invoice_send_approvals a
   WHERE a.quote_id = v_quote_id AND a.status IN ('pending','held','blocked') ORDER BY a.created_at DESC LIMIT 1;
  IF v_appr IS NOT NULL THEN /*isa: merge into the invoice alert*/
    UPDATE public.notifications n
       SET body = v_who || ' accepted online. ' || COALESCE(n.body, ''),
           metadata = COALESCE(n.metadata, '{}'::jsonb) || jsonb_build_object('accepted_online', true, 'accepted_by', v_who)
     WHERE n.type = 'quote_accepted_send_invoice' AND n.metadata->>'approval_id' = v_appr::text
       AND COALESCE(n.metadata->>'accepted_online', '') <> 'true';
  ELSE
    PERFORM public.qa_notify_rep_and_admins(v_quote_id, 'quote_accepted_client',
      'Quote ' || COALESCE(v_num, '') || ' accepted by client',
      v_who || ' accepted quote ' || COALESCE(v_num, '') || ' online.');
  END IF;
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.fl_is_company_office(_uid uuid, _company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _uid IS NOT NULL AND (
    public.p4_is_platform()
    OR (public.has_role(_uid,'admin'::app_role) AND public.get_user_company_id(_uid) = public.fl_master_company_id())
    OR (_company IS NOT NULL AND _company = public.get_user_company_id(_uid)
        AND (public.has_role(_uid,'admin'::app_role) OR public.has_role(_uid,'dispatcher'::app_role)
             OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=_company AND cm.role='admin')))
  ) $function$
;

CREATE OR REPLACE FUNCTION public.fl_lock_quote(_quote uuid, _reason text, _actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.quotes SET locked_at = now(), locked_by = _actor, locked_reason = _reason WHERE id = _quote AND locked_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor)
    SELECT _quote, company_id, 'lock', _reason, _actor FROM public.quotes WHERE id = _quote;
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.fl_quotes_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NOT NULL
     AND coalesce(current_setting('app.quote_lock_bypass', true),'') <> 'on'
     AND (NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount OR NEW.total IS DISTINCT FROM OLD.total
          OR NEW.discount_type IS DISTINCT FROM OLD.discount_type OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
          OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR NEW.payment_plan IS DISTINCT FROM OLD.payment_plan) THEN
    RAISE EXCEPTION 'This quote is confirmed and locked for its installation. An admin must unlock it before it can be changed.' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.unlock_quote(p_quote_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) AND public.fl_is_company_office(auth.uid(), q.company_id)) AND NOT public.p4_is_platform() THEN
    RAISE EXCEPTION 'Only an admin can unlock a confirmed quote' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Please give a reason for unlocking'; END IF;
  IF q.locked_at IS NULL THEN RETURN true; END IF;
  UPDATE public.quotes SET locked_at = NULL, locked_by = NULL, locked_reason = NULL WHERE id = p_quote_id;
  INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor) VALUES (p_quote_id, q.company_id, 'unlock', btrim(p_reason), auth.uid());
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_variation THEN RETURN NEW; END IF; /*r2: site-check updated quotes never create a deposit invoice*/
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    PERFORM public.create_deposit_invoice_for_quote(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_quote_number(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_year_txt text := to_char(now(), 'YYYY');
  v_next int; v_max int; v_num text;
BEGIN
  IF p_company_id IS NULL THEN
    LOOP
      v_next := nextval('quote_number_seq')::int;
      v_num := 'Q-' || v_year_txt || '-' || CASE WHEN v_next < 10000 THEN LPAD(v_next::text, 4, '0') ELSE v_next::text END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quotes WHERE quote_number = v_num);
    END LOOP;
    RETURN v_num;
  END IF;

  INSERT INTO public.company_quote_counters (company_id, year, last_value)
  VALUES (p_company_id, v_year, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_value = CASE WHEN public.company_quote_counters.year = EXCLUDED.year
                          THEN public.company_quote_counters.last_value + 1 ELSE 1 END,
        year = EXCLUDED.year, updated_at = now()
  RETURNING last_value INTO v_next;

  SELECT COALESCE(max(substring(quote_number FROM '^Q-' || v_year_txt || '-([0-9]+)$')::int), 0) INTO v_max
    FROM public.quotes WHERE quote_number LIKE 'Q-' || v_year_txt || '-%';
  v_next := greatest(v_next, v_max + 1);
  LOOP
    v_num := 'Q-' || v_year_txt || '-' || CASE WHEN v_next < 10000 THEN LPAD(v_next::text, 4, '0') ELSE v_next::text END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quotes WHERE quote_number = v_num);
    v_next := v_next + 1;
  END LOOP;
  UPDATE public.company_quote_counters SET last_value = v_next WHERE company_id = p_company_id;
  RETURN v_num;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.p4_is_platform()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(auth.uid(),'platform_super_admin'::app_role) OR public.has_role(auth.uid(),'platform_ops'::app_role) $function$
;


CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq;
CREATE TABLE IF NOT EXISTS public.company_quote_counters (company_id uuid PRIMARY KEY, year int, last_value int, updated_at timestamptz);
CREATE TABLE IF NOT EXISTS public.company_profiles (id uuid, company_id uuid);
CREATE OR REPLACE FUNCTION public.default_company_profile(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.company_profile_snapshot(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.qa_notify_rep_and_admins(uuid, text, text, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- Stub: live creates the deposit invoice as a draft (then queues the timed send).
CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid; BEGIN
  SELECT id INTO v FROM public.invoices WHERE quote_id = p_quote_id AND status NOT IN ('void','cancelled') LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF; -- live is one deposit invoice per quote
  INSERT INTO public.invoices (company_id, quote_id, customer_id, invoice_number, status, grand_total)
  SELECT company_id, id, customer_id, 'INV-D-' || replace(id::text,'-',''), 'draft', total FROM public.quotes WHERE id = p_quote_id RETURNING id INTO v;
  RETURN v; END $$;

ALTER TABLE public.quote_lock_events ADD CONSTRAINT quote_lock_events_action_check CHECK (action = ANY (ARRAY['lock','unlock']));
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check CHECK (status = ANY (ARRAY['draft','sent','viewed','accepted','declined']));

CREATE TRIGGER trg_quotes_lock_guard BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION fl_quotes_lock_guard();
CREATE TRIGGER on_quote_accepted AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION create_invoice_from_accepted_quote();
CREATE TRIGGER trg_recalc_quote_totals AFTER INSERT OR UPDATE OR DELETE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION recalc_quote_totals();
CREATE TRIGGER trg_invoice_guard BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION trg_invoice_guard();
CREATE TRIGGER trg_client_contact_fill_invoice BEFORE INSERT OR UPDATE OF customer_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION _client_contact_fill_invoice();
CREATE TRIGGER trg_client_contact_push AFTER UPDATE OF name, first_name, last_name, email, phone, address, primary_address_line1, primary_address_line2, city, postal_code ON public.customers
  FOR EACH ROW EXECUTE FUNCTION _client_contact_push();
