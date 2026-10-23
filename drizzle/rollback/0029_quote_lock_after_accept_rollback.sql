-- Rollback for 0029_quote_lock_after_accept. Restores the exact live (pre-0029) bodies, drops the new
-- triggers and functions, and removes the 'accepted' locks 0029 added (site-check locks are kept).
BEGIN;
SELECT set_config('app.quote_lock_bypass', 'on', true);
DROP TRIGGER IF EXISTS trg_quote_areas_lock_guard ON public.quote_areas;
DROP TRIGGER IF EXISTS trg_quote_line_items_lock_guard ON public.quote_line_items;
DROP TRIGGER IF EXISTS trg_proposal_sections_lock_guard ON public.proposal_sections;
DROP TRIGGER IF EXISTS trg_quotes_autolock_on_accept ON public.quotes;
DROP TRIGGER IF EXISTS trg_customers_billing_guard ON public.customers;

CREATE OR REPLACE FUNCTION public.fl_quote_items_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.quote_lock_bypass', true),'') <> 'on'
     AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = coalesce(NEW.quote_id, OLD.quote_id) AND q.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This quote is confirmed and locked for its installation. An admin must unlock it before it can be changed.' USING ERRCODE='P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
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

DELETE FROM public.quote_lock_events WHERE action = 'lock' AND reason IN ('accepted', 'accepted (0029 backfill)', 'Locked again by admin');
UPDATE public.quotes SET locked_at = NULL, locked_by = NULL, locked_reason = NULL WHERE locked_reason = 'accepted';
DROP FUNCTION IF EXISTS public.quote_lock_state(uuid);
DROP FUNCTION IF EXISTS public.admin_correct_client_details(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.fl_customers_billing_guard();
DROP FUNCTION IF EXISTS public.fl_customer_has_locked_work(uuid);
DROP FUNCTION IF EXISTS public.admin_create_quote_variation(uuid, text);
DROP FUNCTION IF EXISTS public.relock_quote(uuid);
DROP FUNCTION IF EXISTS public.fl_quote_autolock_on_accept();
DROP FUNCTION IF EXISTS public.fl_quote_edit_block(uuid);
DROP FUNCTION IF EXISTS public.fl_quote_issued_invoice(uuid);
DROP FUNCTION IF EXISTS public.fl_quote_admin(uuid, uuid);
COMMIT;
