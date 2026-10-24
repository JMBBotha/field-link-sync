-- 0030: Invoice payment dates (Johan via WALDA, 24 Oct 08:37). Step 1 of cash-flow forecast.
-- Each invoice gets two expected payments:
--   Deposit : amount = invoices.deposit_amount (unchanged). Expected date = override, else issue date + effective terms
--             (invoice terms > client terms > company default, existing _inv_terms()).
--   Final   : amount = grand_total - deposit_amount - credit notes. Expected date = override, else deposit date + N days
--             (N = invoice override > client default > 30). With no deposit on the invoice there is one payment ("Final"),
--             expected on the terms date (override still allowed).
--   Status: paid / part_paid / outstanding / overdue / not_sent (draft) / void / none.
--   Paid / outstanding is DERIVED from settled payments (invoice_amount_paid), applied to the deposit first.
-- Additive only: three nullable columns on invoices, one on customers, NULL = automatic. No existing row is updated,
-- no amount changes, no status changes, no emails (date columns are not in trg_invoice_guard's locked list and fire
-- no send/paid triggers). Owner/admin only to edit; office/admin + the rep on the invoice can read.
-- Rollback: drizzle/rollback/0030_invoice_payment_dates_rollback.sql

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS expected_deposit_date date,
  ADD COLUMN IF NOT EXISTS expected_final_date date,
  ADD COLUMN IF NOT EXISTS final_after_days int;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_final_after_days_chk;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_final_after_days_chk CHECK (final_after_days IS NULL OR final_after_days BETWEEN 0 AND 365);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS final_after_days int;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_final_after_days_chk;
ALTER TABLE public.customers ADD CONSTRAINT customers_final_after_days_chk CHECK (final_after_days IS NULL OR final_after_days BETWEEN 0 AND 365);

-- Pure schedule maths (no access check; internal only).
CREATE OR REPLACE FUNCTION public._inv_pay_schedule(p_invoice uuid)
 RETURNS TABLE (invoice_id uuid, has_deposit boolean,
   deposit_amount numeric, deposit_date date, deposit_date_auto boolean, deposit_paid numeric, deposit_outstanding numeric, deposit_status text,
   final_amount numeric, final_date date, final_date_auto boolean, final_after_days int, final_paid numeric, final_outstanding numeric, final_status text,
   terms_days int)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE i public.invoices; t record; v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_paid numeric; v_cred numeric := 0; v_dep numeric; v_fin numeric; v_base date; v_ddate date; v_fdays int; v_fdate date; v_cust_days int;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice; IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO t FROM public._inv_terms(p_invoice);
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE payments.invoice_id = p_invoice AND status IN ('paid','succeeded','completed');
  SELECT COALESCE(SUM(total),0) INTO v_cred FROM public.credit_notes cn WHERE cn.invoice_id = p_invoice AND COALESCE(cn.status,'') <> 'void';
  SELECT c.final_after_days INTO v_cust_days FROM public.customers c WHERE c.id = i.customer_id;
  v_dep := CASE WHEN COALESCE(i.deposit_amount,0) > 0 THEN round(i.deposit_amount,2) ELSE 0 END;
  v_fin := GREATEST(0, round(COALESCE(i.grand_total,0) - v_dep - v_cred, 2));
  v_base := COALESCE(i.issue_date, (i.created_at at time zone 'Africa/Johannesburg')::date) + COALESCE(t.days, 30);
  v_ddate := COALESCE(i.expected_deposit_date, v_base);
  v_fdays := COALESCE(i.final_after_days, v_cust_days, 30);
  v_fdate := COALESCE(i.expected_final_date, CASE WHEN v_dep > 0 THEN v_ddate + v_fdays ELSE v_ddate END);
  invoice_id := i.id; has_deposit := v_dep > 0; terms_days := COALESCE(t.days, 30);
  deposit_amount := v_dep; deposit_date := CASE WHEN v_dep > 0 THEN v_ddate END; deposit_date_auto := i.expected_deposit_date IS NULL;
  deposit_paid := LEAST(v_paid, v_dep); deposit_outstanding := v_dep - LEAST(v_paid, v_dep);
  final_amount := v_fin; final_date := v_fdate; final_date_auto := i.expected_final_date IS NULL; final_after_days := v_fdays;
  final_paid := LEAST(GREATEST(v_paid - v_dep, 0), v_fin); final_outstanding := v_fin - LEAST(GREATEST(v_paid - v_dep, 0), v_fin);
  deposit_status := CASE WHEN v_dep = 0 THEN 'none' WHEN deposit_outstanding <= 0.005 THEN 'paid'
    WHEN lower(COALESCE(i.status,'')) IN ('void','cancelled') THEN 'void' WHEN v_ddate < v_today THEN 'overdue'
    WHEN deposit_paid > 0 THEN 'part_paid' ELSE 'outstanding' END;
  final_status := CASE WHEN lower(COALESCE(i.status,'')) IN ('void','cancelled') THEN 'void' WHEN final_outstanding <= 0.005 THEN 'paid'
    WHEN v_fdate < v_today THEN 'overdue' WHEN final_paid > 0 THEN 'part_paid' ELSE 'outstanding' END;
  IF lower(COALESCE(i.status,'')) IN ('void','cancelled') AND v_dep > 0 AND deposit_status <> 'paid' THEN deposit_status := 'void'; END IF;
  -- Draft = not sent yet: never "overdue", shown as not sent (still counts as expected money in the forecast).
  IF lower(COALESCE(i.status,'')) = 'draft' THEN
    IF deposit_status IN ('overdue','outstanding') THEN deposit_status := 'not_sent'; END IF;
    IF final_status IN ('overdue','outstanding') THEN final_status := 'not_sent'; END IF;
  END IF;
  RETURN NEXT;
END $function$;
REVOKE ALL ON FUNCTION public._inv_pay_schedule(uuid) FROM public, anon, authenticated;

-- Read: same company; office/admin, or the sales rep on the invoice. Field techs never.
CREATE OR REPLACE FUNCTION public.invoice_payment_schedule(p_invoice uuid)
 RETURNS TABLE (invoice_id uuid, has_deposit boolean,
   deposit_amount numeric, deposit_date date, deposit_date_auto boolean, deposit_paid numeric, deposit_outstanding numeric, deposit_status text,
   final_amount numeric, final_date date, final_date_auto boolean, final_after_days int, final_paid numeric, final_outstanding numeric, final_status text,
   terms_days int, can_edit boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid; v_uid uuid := auth.uid(); v_admin boolean;
BEGIN
  SELECT company_id INTO v_co FROM public.invoices WHERE id = p_invoice;
  IF v_uid IS NULL OR v_co IS NULL OR v_co IS DISTINCT FROM public.get_user_company_id(v_uid) OR public.is_field_tech_only(v_uid) THEN RETURN; END IF;
  v_admin := public.has_role(v_uid,'admin'::app_role);
  IF NOT (v_admin OR public.has_role(v_uid,'dispatcher'::app_role) OR (public.is_sales_rep(v_uid) AND public._inv_rep(p_invoice) = v_uid)) THEN RETURN; END IF;
  RETURN QUERY SELECT s.*, v_admin FROM public._inv_pay_schedule(p_invoice) s;
END $function$;
GRANT EXECUTE ON FUNCTION public.invoice_payment_schedule(uuid) TO authenticated;

-- Edit (owner/admin of the invoice's company). NULL = back to automatic. Touches only the three date columns.
CREATE OR REPLACE FUNCTION public.set_invoice_payment_dates(p_invoice uuid, p_deposit_date date, p_final_after_days int, p_final_date date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.invoices WHERE id = p_invoice;
  IF v_co IS NULL OR v_co IS DISTINCT FROM public.get_user_company_id(auth.uid()) OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the owner or an admin can change payment dates' USING ERRCODE = '42501'; END IF;
  IF p_final_after_days IS NOT NULL AND (p_final_after_days < 0 OR p_final_after_days > 365) THEN RAISE EXCEPTION 'Days must be 0 to 365'; END IF;
  IF p_deposit_date IS NOT NULL AND p_final_date IS NOT NULL AND p_final_date < p_deposit_date THEN
    RAISE EXCEPTION 'Final payment date cannot be before the deposit date'; END IF;
  UPDATE public.invoices SET expected_deposit_date = p_deposit_date, final_after_days = p_final_after_days, expected_final_date = p_final_date
   WHERE id = p_invoice;
END $function$;
GRANT EXECUTE ON FUNCTION public.set_invoice_payment_dates(uuid, date, int, date) TO authenticated;

-- Client default "final payment N days after deposit" (owner/admin). NULL = 30.
CREATE OR REPLACE FUNCTION public.set_customer_final_after_days(p_customer uuid, p_days int)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.customers WHERE id = p_customer;
  IF v_co IS NULL OR v_co IS DISTINCT FROM public.get_user_company_id(auth.uid()) OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Only the owner or an admin can change payment terms' USING ERRCODE = '42501'; END IF;
  IF p_days IS NOT NULL AND (p_days < 0 OR p_days > 365) THEN RAISE EXCEPTION 'Days must be 0 to 365'; END IF;
  UPDATE public.customers SET final_after_days = p_days WHERE id = p_customer;
END $function$;
GRANT EXECUTE ON FUNCTION public.set_customer_final_after_days(uuid, int) TO authenticated;
