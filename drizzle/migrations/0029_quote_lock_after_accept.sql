-- 0029: Lock quotes once accepted; fully lock once invoiced. Enforced in the database, not only in the UI.
--
-- Rules
--   draft / sent / viewed : editable as before (owner rep + office + admins, per existing RLS).
--   accepted              : locked automatically (locked_reason 'accepted'). Nobody edits lines, areas,
--                           sections, prices, terms or the client on the quote. An admin can
--                           "Unlock to edit" (reason required, written to quote_lock_events + audit_log);
--                           while unlocked only admins can edit. "Lock again" re-locks it.
--   invoiced / paid       : an invoice on the quote has been issued (status not draft/void/cancelled).
--                           Content is locked for everyone, admins included, and cannot be unlocked.
--                           Changes go through a variation (new linked quote) or a credit note.
--   client details        : on a client with accepted work or an issued invoice, VAT number, billing
--                           name and address can only be changed by an admin (logged). Issued invoices
--                           are never rewritten (trg_invoice_guard already refuses); fix = reissue / credit note.
--
-- Bypass: set_config('app.quote_lock_bypass','on',true) (used by site check, quote_delete, this file).
-- Rollback: drizzle/rollback/0029_quote_lock_after_accept_rollback.sql
-- NOTE: applying this backfills a lock onto every quote that is already accepted (see section 9).

-- 1. Who counts as an admin for quote locks (same shape as fl_is_company_office, minus dispatchers/reps).
--    coalesce(..., false): with no master company the comparison is NULL, and NOT NULL would let a check pass.
CREATE OR REPLACE FUNCTION public.fl_quote_admin(_uid uuid, _company uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(_uid IS NOT NULL AND (
    public.has_role(_uid,'platform_super_admin'::app_role) OR public.has_role(_uid,'platform_ops'::app_role)
    OR (public.has_role(_uid,'admin'::app_role) AND public.get_user_company_id(_uid) = public.fl_master_company_id())
    OR (_company IS NOT NULL AND _company = public.get_user_company_id(_uid)
        AND (public.has_role(_uid,'admin'::app_role)
             OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=_company AND cm.role='admin')))
  ), false) $function$;

-- 2. First issued invoice on a quote ("INV-036 (paid)"), or NULL.
CREATE OR REPLACE FUNCTION public.fl_quote_issued_invoice(_quote uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(i.invoice_number, 'invoice') || ' (' || replace(i.status, '_', ' ') || ')'
    FROM public.invoices i
   WHERE i.quote_id = _quote AND coalesce(i.status,'draft') NOT IN ('draft','void','cancelled')
   ORDER BY i.created_at LIMIT 1 $function$;

-- 3. Why the caller may not change this quote's content right now (NULL = allowed).
CREATE OR REPLACE FUNCTION public.fl_quote_edit_block(_quote uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q record; v_inv text;
BEGIN
  IF coalesce(current_setting('app.quote_lock_bypass', true),'') = 'on' THEN RETURN NULL; END IF;
  SELECT id, company_id, status, locked_at, locked_reason INTO q FROM public.quotes WHERE id = _quote;
  IF q.id IS NULL THEN RETURN NULL; END IF;
  v_inv := public.fl_quote_issued_invoice(_quote);
  IF v_inv IS NOT NULL THEN
    RETURN 'Locked: invoiced ' || v_inv || '. This quote can no longer change. An admin can create a variation (new linked quote) or a credit note.';
  END IF;
  IF q.locked_at IS NOT NULL THEN
    IF coalesce(q.locked_reason,'') = 'accepted' THEN
      RETURN 'Locked: accepted. Only an admin can unlock it (with a reason) or create a variation.';
    END IF;
    RETURN 'This quote is confirmed and locked for its installation. An admin must unlock it before it can be changed.';
  END IF;
  IF q.status = 'accepted' AND NOT public.fl_quote_admin(auth.uid(), q.company_id) THEN
    RETURN 'Locked: accepted. Only an admin can change an accepted quote.';
  END IF;
  RETURN NULL;
END $function$;

-- 4. Child tables: lines, areas, legacy line items, proposal sections.
CREATE OR REPLACE FUNCTION public.fl_quote_items_lock_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_msg text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_msg := public.fl_quote_edit_block(OLD.quote_id); END IF;
  IF v_msg IS NULL AND TG_OP = 'INSERT' THEN v_msg := public.fl_quote_edit_block(NEW.quote_id); END IF;
  IF v_msg IS NULL AND TG_OP = 'UPDATE' AND NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN
    v_msg := public.fl_quote_edit_block(NEW.quote_id);
  END IF;
  IF v_msg IS NOT NULL THEN RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001'; END IF;
  RETURN coalesce(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS trg_quote_areas_lock_guard ON public.quote_areas;
CREATE TRIGGER trg_quote_areas_lock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quote_areas
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_items_lock_guard();
DROP TRIGGER IF EXISTS trg_quote_line_items_lock_guard ON public.quote_line_items;
CREATE TRIGGER trg_quote_line_items_lock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quote_line_items
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_items_lock_guard();
DROP TRIGGER IF EXISTS trg_proposal_sections_lock_guard ON public.proposal_sections;
CREATE TRIGGER trg_proposal_sections_lock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.proposal_sections
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_items_lock_guard();

-- 5. The quote row: content columns are frozen while locked. Status/sent/follow-up/job/lock/archive columns stay free.
CREATE OR REPLACE FUNCTION public.fl_quotes_lock_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_msg text;
BEGIN
  IF coalesce(current_setting('app.quote_lock_bypass', true),'') = 'on' THEN RETURN NEW; END IF;
  IF round(coalesce(NEW.subtotal,0),2) IS DISTINCT FROM round(coalesce(OLD.subtotal,0),2)
     OR round(coalesce(NEW.vat_amount,0),2) IS DISTINCT FROM round(coalesce(OLD.vat_amount,0),2)
     OR round(coalesce(NEW.total,0),2) IS DISTINCT FROM round(coalesce(OLD.total,0),2)
     OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate
     OR NEW.discount_type IS DISTINCT FROM OLD.discount_type OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
     OR NEW.payment_plan IS DISTINCT FROM OLD.payment_plan
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.terms_text IS DISTINCT FROM OLD.terms_text
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.reference_text IS DISTINCT FROM OLD.reference_text
     OR NEW.visual_sections IS DISTINCT FROM OLD.visual_sections
     OR NEW.units_markup_percent IS DISTINCT FROM OLD.units_markup_percent
     OR NEW.materials_markup_percent IS DISTINCT FROM OLD.materials_markup_percent
     OR NEW.materials_waste_percent IS DISTINCT FROM OLD.materials_waste_percent
     OR NEW.labour_mode IS DISTINCT FROM OLD.labour_mode OR NEW.labour_included IS DISTINCT FROM OLD.labour_included
     OR NEW.show_unit_cards IS DISTINCT FROM OLD.show_unit_cards OR NEW.client_summary IS DISTINCT FROM OLD.client_summary
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR (OLD.status = 'accepted' AND (NEW.status IS DISTINCT FROM OLD.status
         OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
         OR NEW.accepted_signature IS DISTINCT FROM OLD.accepted_signature
         OR NEW.accepted_version_id IS DISTINCT FROM OLD.accepted_version_id)) THEN
    v_msg := public.fl_quote_edit_block(OLD.id);  -- reads the row as it is before this update
    IF v_msg IS NOT NULL THEN RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 6. Auto-lock when a quote becomes accepted (client link, staff accept, assistant, anything).
CREATE OR REPLACE FUNCTION public.fl_quote_autolock_on_accept()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now(); NEW.locked_by := auth.uid(); NEW.locked_reason := 'accepted';
    INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor)
    VALUES (NEW.id, NEW.company_id, 'lock', 'accepted', auth.uid());
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_quotes_autolock_on_accept ON public.quotes;
CREATE TRIGGER trg_quotes_autolock_on_accept BEFORE UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_autolock_on_accept();

-- Site check / variation locks may replace the plain 'accepted' lock with their own reason.
CREATE OR REPLACE FUNCTION public.fl_lock_quote(_quote uuid, _reason text, _actor uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.quotes SET locked_at = now(), locked_by = _actor, locked_reason = _reason
   WHERE id = _quote AND (locked_at IS NULL OR (locked_reason = 'accepted' AND _reason IS DISTINCT FROM 'accepted'));
  IF FOUND THEN
    INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor)
    SELECT _quote, company_id, 'lock', _reason, _actor FROM public.quotes WHERE id = _quote;
  END IF;
END $function$;

-- 7. Admin: unlock (refused once invoiced), lock again. Both logged.
CREATE OR REPLACE FUNCTION public.unlock_quote(p_quote_id uuid, p_reason text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q record; v_inv text;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT public.fl_quote_admin(auth.uid(), q.company_id) THEN
    RAISE EXCEPTION 'Only an admin can unlock a confirmed quote' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Please give a reason for unlocking'; END IF;
  v_inv := public.fl_quote_issued_invoice(p_quote_id);
  IF v_inv IS NOT NULL THEN
    RAISE EXCEPTION 'Locked: invoiced %. It cannot be unlocked. Create a variation (new linked quote) or a credit note instead.', v_inv USING ERRCODE='P0001';
  END IF;
  IF q.locked_at IS NULL THEN RETURN true; END IF;
  UPDATE public.quotes SET locked_at = NULL, locked_by = NULL, locked_reason = NULL WHERE id = p_quote_id;
  INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor) VALUES (p_quote_id, q.company_id, 'unlock', btrim(p_reason), auth.uid());
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('quotes', p_quote_id, 'update', jsonb_build_object('locked_at', q.locked_at, 'locked_reason', q.locked_reason, 'status', q.status),
          jsonb_build_object('event', 'quote_unlocked', 'reason', btrim(p_reason), 'quote_number', q.quote_number), auth.uid(), q.company_id);
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.relock_quote(p_quote_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT public.fl_quote_admin(auth.uid(), q.company_id) THEN
    RAISE EXCEPTION 'Only an admin can lock a quote' USING ERRCODE='42501';
  END IF;
  IF q.locked_at IS NOT NULL THEN RETURN true; END IF;
  IF q.status <> 'accepted' THEN RAISE EXCEPTION 'Only accepted quotes are locked'; END IF;
  UPDATE public.quotes SET locked_at = now(), locked_by = auth.uid(), locked_reason = 'accepted' WHERE id = p_quote_id;
  INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor) VALUES (p_quote_id, q.company_id, 'lock', 'Locked again by admin', auth.uid());
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('quotes', p_quote_id, 'update', jsonb_build_object('locked_at', NULL),
          jsonb_build_object('event', 'quote_relocked', 'quote_number', q.quote_number, 'total', q.total), auth.uid(), q.company_id);
  RETURN true;
END $function$;

-- 8. Admin: variation = a new draft quote linked to the accepted one (same client/site/rep, areas copied
--    empty, no lines). Only the extra or changed work goes on it; it is sent, accepted and invoiced like any
--    quote (so it is NOT is_variation, which is the site-check flow). Removing work = credit note.
CREATE OR REPLACE FUNCTION public.admin_create_quote_variation(p_quote_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q public.quotes; v_new uuid; v_num text; v_reason text := btrim(coalesce(p_reason,''));
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT public.fl_quote_admin(auth.uid(), q.company_id) THEN
    RAISE EXCEPTION 'Only an admin can create a variation' USING ERRCODE='42501';
  END IF;
  IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Please give a reason for the variation'; END IF;
  IF q.status <> 'accepted' THEN RAISE EXCEPTION 'Variations are for accepted quotes. Edit the quote itself instead.'; END IF;
  v_num := public.generate_quote_number(q.company_id);
  INSERT INTO public.quotes (company_id, customer_id, customer_name, sales_engineer_id, owner_id, created_by, status, quote_number,
    vat_rate, terms_text, reference_text, location_id, site_id, units_markup_percent, materials_markup_percent, labour_mode,
    materials_waste_percent, show_unit_cards, labour_included, parent_quote_id, is_variation, variation_summary)
  VALUES (q.company_id, q.customer_id, q.customer_name, q.sales_engineer_id, q.owner_id, auth.uid(), 'draft', v_num,
    q.vat_rate, q.terms_text, left('Variation to ' || coalesce(q.quote_number,'quote') || ': ' || v_reason, 500),
    q.location_id, q.site_id, q.units_markup_percent, q.materials_markup_percent, q.labour_mode,
    q.materials_waste_percent, q.show_unit_cards, q.labour_included, q.id, false,
    jsonb_build_object('kind', 'admin_variation', 'reason', v_reason, 'parent_quote_id', q.id,
                       'parent_quote_number', q.quote_number, 'created_by', auth.uid(), 'created_at', now()))
  RETURNING id INTO v_new;
  INSERT INTO public.quote_areas (quote_id, name, sort_order, description)
  SELECT v_new, a.name, a.sort_order, a.description FROM public.quote_areas a WHERE a.quote_id = q.id ORDER BY a.sort_order;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('quotes', q.id, 'update', NULL,
          jsonb_build_object('event', 'variation_created', 'reason', v_reason, 'variation_quote_id', v_new, 'variation_quote_number', v_num),
          auth.uid(), q.company_id);
  RETURN jsonb_build_object('quote_id', v_new, 'quote_number', v_num);
END $function$;

-- 9. Client billing details: admin-only once the client has accepted work or an issued invoice.
CREATE OR REPLACE FUNCTION public.fl_customer_has_locked_work(_customer uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.quotes q WHERE q.customer_id = _customer AND q.status = 'accepted')
      OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.customer_id = _customer AND coalesce(i.status,'draft') NOT IN ('draft','void','cancelled')) $function$;

CREATE OR REPLACE FUNCTION public.fl_customers_billing_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (NEW.vat_number IS DISTINCT FROM OLD.vat_number OR NEW.name IS DISTINCT FROM OLD.name
          OR NEW.company_name IS DISTINCT FROM OLD.company_name OR NEW.address IS DISTINCT FROM OLD.address
          OR NEW.primary_address_line1 IS DISTINCT FROM OLD.primary_address_line1
          OR NEW.primary_address_line2 IS DISTINCT FROM OLD.primary_address_line2
          OR NEW.city IS DISTINCT FROM OLD.city OR NEW.postal_code IS DISTINCT FROM OLD.postal_code) THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR coalesce(current_setting('app.quote_lock_bypass', true),'') = 'on'
     OR NOT public.fl_customer_has_locked_work(OLD.id) THEN
    RETURN NEW;
  END IF;
  IF NOT public.fl_quote_admin(auth.uid(), OLD.company_id) THEN
    RAISE EXCEPTION 'This client has accepted work or an issued invoice, so VAT number, billing name and address can only be corrected by an admin.' USING ERRCODE = '42501';
  END IF;
  -- Admin editing directly (client page): still logged.
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('customers', OLD.id, 'update',
          jsonb_build_object('name', OLD.name, 'company_name', OLD.company_name, 'vat_number', OLD.vat_number, 'address', OLD.address,
                             'primary_address_line1', OLD.primary_address_line1, 'primary_address_line2', OLD.primary_address_line2,
                             'city', OLD.city, 'postal_code', OLD.postal_code),
          jsonb_build_object('event', 'client_details_corrected', 'name', NEW.name, 'company_name', NEW.company_name, 'vat_number', NEW.vat_number,
                             'address', NEW.address, 'primary_address_line1', NEW.primary_address_line1, 'primary_address_line2', NEW.primary_address_line2,
                             'city', NEW.city, 'postal_code', NEW.postal_code, 'reason', nullif(current_setting('app.client_correction_reason', true), '')),
          auth.uid(), OLD.company_id);
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_customers_billing_guard ON public.customers;
CREATE TRIGGER trg_customers_billing_guard BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fl_customers_billing_guard();

CREATE OR REPLACE FUNCTION public.admin_correct_client_details(p_quote_id uuid, p_changes jsonb, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q record; c public.customers; v_reason text := btrim(coalesce(p_reason,'')); k text; v_drafts int := 0; v_issued jsonb;
  allowed text[] := ARRAY['name','company_name','vat_number','primary_address_line1','primary_address_line2','city','postal_code','email','phone'];
BEGIN
  SELECT id, company_id, customer_id INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT public.fl_quote_admin(auth.uid(), q.company_id) THEN
    RAISE EXCEPTION 'Only an admin can correct client details on an accepted quote' USING ERRCODE='42501';
  END IF;
  IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Please give a reason for the correction'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'No changes given'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT k = ANY(allowed) THEN RAISE EXCEPTION 'Field % cannot be changed here', k; END IF;
  END LOOP;
  SELECT * INTO c FROM public.customers WHERE id = q.customer_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'This quote has no client'; END IF;
  PERFORM set_config('app.client_correction_reason', v_reason, true);
  UPDATE public.customers SET
    name = CASE WHEN p_changes ? 'name' THEN nullif(btrim(p_changes->>'name'),'') ELSE name END,
    company_name = CASE WHEN p_changes ? 'company_name' THEN nullif(btrim(p_changes->>'company_name'),'') ELSE company_name END,
    vat_number = CASE WHEN p_changes ? 'vat_number' THEN nullif(btrim(p_changes->>'vat_number'),'') ELSE vat_number END,
    primary_address_line1 = CASE WHEN p_changes ? 'primary_address_line1' THEN nullif(btrim(p_changes->>'primary_address_line1'),'') ELSE primary_address_line1 END,
    primary_address_line2 = CASE WHEN p_changes ? 'primary_address_line2' THEN nullif(btrim(p_changes->>'primary_address_line2'),'') ELSE primary_address_line2 END,
    city = CASE WHEN p_changes ? 'city' THEN nullif(btrim(p_changes->>'city'),'') ELSE city END,
    postal_code = CASE WHEN p_changes ? 'postal_code' THEN nullif(btrim(p_changes->>'postal_code'),'') ELSE postal_code END,
    email = CASE WHEN p_changes ? 'email' THEN nullif(btrim(p_changes->>'email'),'') ELSE email END,
    phone = CASE WHEN p_changes ? 'phone' THEN nullif(btrim(p_changes->>'phone'),'') ELSE phone END,
    address = CASE WHEN p_changes ?| ARRAY['primary_address_line1','primary_address_line2','city','postal_code'] THEN
      nullif(concat_ws(', ',
        nullif(btrim(CASE WHEN p_changes ? 'primary_address_line1' THEN p_changes->>'primary_address_line1' ELSE primary_address_line1 END),''),
        nullif(btrim(CASE WHEN p_changes ? 'primary_address_line2' THEN p_changes->>'primary_address_line2' ELSE primary_address_line2 END),''),
        nullif(btrim(CASE WHEN p_changes ? 'city' THEN p_changes->>'city' ELSE city END),''),
        nullif(btrim(CASE WHEN p_changes ? 'postal_code' THEN p_changes->>'postal_code' ELSE postal_code END),'')), '')
      ELSE address END,
    updated_at = now()
  WHERE id = c.id;
  -- Not-yet-issued invoices pick up the new VAT number (name/address follow via the 0023 contact push).
  IF p_changes ? 'vat_number' THEN
    UPDATE public.invoices SET billed_to_vat_number = nullif(btrim(p_changes->>'vat_number'),'')
     WHERE customer_id = c.id AND coalesce(status,'draft') = 'draft';
    GET DIAGNOSTICS v_drafts = ROW_COUNT;
  END IF;
  -- Make sure there is a log row even if the guard did not write one (client without locked work).
  IF NOT public.fl_customer_has_locked_work(c.id) THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
    VALUES ('customers', c.id, 'update', to_jsonb(c) - 'search_aliases',
            p_changes || jsonb_build_object('event', 'client_details_corrected', 'reason', v_reason), auth.uid(), c.company_id);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number, 'status', i.status) ORDER BY i.created_at), '[]')
    INTO v_issued FROM public.invoices i
   WHERE i.customer_id = c.id AND coalesce(i.status,'draft') NOT IN ('draft','void','cancelled');
  RETURN jsonb_build_object('customer_id', c.id, 'draft_invoices_updated', v_drafts, 'issued_invoices_unchanged', v_issued);
END $function$;

-- 0023 fix: only draft invoices follow client contact edits. Issued invoices are immutable
-- (trg_invoice_guard), so pushing into a sent / partly paid invoice made the whole client edit fail.
CREATE OR REPLACE FUNCTION public._client_contact_push()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.invoices set customer_id = customer_id
   where customer_id = new.id and coalesce(status,'draft') = 'draft';
  return new;
end $function$;

-- 10. One call for the UI: what is locked and what this user may do.
CREATE OR REPLACE FUNCTION public.quote_lock_state(p_quote_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE q record; v_inv record; v_admin boolean; v_state text; v_unlock record; v_vars jsonb; v_parent jsonb;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RETURN NULL; END IF;
  IF auth.uid() IS NULL OR NOT (public.p4_is_platform() OR q.company_id = public.get_user_company_id(auth.uid())
                                OR public.fl_quote_admin(auth.uid(), q.company_id)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;
  v_admin := public.fl_quote_admin(auth.uid(), q.company_id);
  SELECT i.invoice_number, i.status INTO v_inv FROM public.invoices i
   WHERE i.quote_id = q.id AND coalesce(i.status,'draft') NOT IN ('draft','void','cancelled') ORDER BY i.created_at LIMIT 1;
  v_state := CASE
    WHEN v_inv.status IS NOT NULL THEN 'invoiced'
    WHEN q.locked_at IS NOT NULL AND coalesce(q.locked_reason,'') = 'accepted' THEN 'accepted_locked'
    WHEN q.locked_at IS NOT NULL THEN 'confirmed_locked'
    WHEN q.status = 'accepted' THEN 'accepted_unlocked'
    ELSE 'open' END;
  SELECT e.created_at, e.reason, p.full_name INTO v_unlock FROM public.quote_lock_events e LEFT JOIN public.profiles p ON p.id = e.actor
   WHERE e.quote_id = q.id AND e.action = 'unlock' ORDER BY e.created_at DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'quote_number', v.quote_number, 'status', v.status, 'total', v.total) ORDER BY v.created_at), '[]')
    INTO v_vars FROM public.quotes v WHERE v.parent_quote_id = q.id AND NOT coalesce(v.is_variation, false);
  IF q.parent_quote_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', p.id, 'quote_number', p.quote_number) INTO v_parent FROM public.quotes p WHERE p.id = q.parent_quote_id;
  END IF;
  RETURN jsonb_build_object(
    'state', v_state, 'status', q.status, 'locked_at', q.locked_at, 'locked_reason', q.locked_reason,
    'invoice_number', v_inv.invoice_number, 'invoice_status', v_inv.status,
    'is_admin', v_admin,
    'can_edit', v_state = 'open' OR (v_state = 'accepted_unlocked' AND v_admin),
    'can_unlock', v_admin AND v_state IN ('accepted_locked','confirmed_locked'),
    'can_relock', v_admin AND v_state = 'accepted_unlocked',
    'can_variation', v_admin AND q.status = 'accepted' AND NOT coalesce(q.is_variation, false),
    'can_correct_client', v_admin AND q.customer_id IS NOT NULL,
    'last_unlock', CASE WHEN v_unlock.created_at IS NULL THEN NULL ELSE jsonb_build_object('at', v_unlock.created_at, 'reason', v_unlock.reason, 'by', v_unlock.full_name) END,
    'variations', v_vars, 'parent', v_parent,
    'is_variation', coalesce(q.is_variation, false), 'variation_kind', q.variation_summary->>'kind');
END $function$;

REVOKE ALL ON FUNCTION public.fl_quote_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fl_quote_issued_invoice(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_quote_edit_block(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fl_customer_has_locked_work(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.relock_quote(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_quote_variation(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_correct_client_details(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_lock_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fl_quote_autolock_on_accept() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_customers_billing_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_quote_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fl_quote_edit_block(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relock_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_quote_variation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correct_client_details(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_lock_state(uuid) TO authenticated;

-- 11. Backfill: quotes already accepted get the 'accepted' lock (live: 5 quotes on 23 Oct, incl. PGE Q-2026-0036).
DO $$ BEGIN
  PERFORM set_config('app.quote_lock_bypass', 'on', true);
  INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor)
  SELECT id, company_id, 'lock', 'accepted (0029 backfill)', NULL FROM public.quotes WHERE status = 'accepted' AND locked_at IS NULL;
  UPDATE public.quotes SET locked_at = coalesce(accepted_at, now()), locked_reason = 'accepted'
   WHERE status = 'accepted' AND locked_at IS NULL;
  PERFORM set_config('app.quote_lock_bypass', '', true);
END $$;
