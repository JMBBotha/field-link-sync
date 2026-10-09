-- Accounting step 2 (2026-10-09): credit notes (write-offs, deductions, discounts, rounding).
-- A credit note reduces what the client owes and the VAT on that invoice (VAT at the invoice's own rate).
-- Issued only through issue_credit_note() by office staff (not techs, not salespeople). Never deleted: void instead.
DO $b$ BEGIN
  IF md5(pg_get_functiondef('public.recalc_invoice_status()'::regprocedure)) <> '5a15100d1c744a88601091fdc916e58e'
  OR md5(pg_get_functiondef('public.get_invoice_aging_report()'::regprocedure)) <> 'f9e407caaeb0b68208a922306ec2c5e0' THEN
    RAISE EXCEPTION 'invoice status/aging functions changed since review - stop'; END IF;
  INSERT INTO public._acct_backups(step, object, definition)
  SELECT 'acct2', p.oid::regprocedure::text, pg_get_functiondef(p.oid) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('recalc_invoice_status', 'get_invoice_aging_report');
END $b$;

CREATE SEQUENCE IF NOT EXISTS public.credit_note_number_seq;
CREATE TABLE IF NOT EXISTS public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  customer_id uuid,
  credit_note_number text NOT NULL UNIQUE,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text NOT NULL CHECK (reason IN ('write_off', 'deduction', 'discount', 'rounding', 'other')),
  description text,
  subtotal numeric(12,2) NOT NULL,
  tax_rate numeric NOT NULL,
  tax_amount numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL CHECK (total > 0),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  void_reason text, voided_at timestamptz, voided_by uuid,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_notes_invoice_idx ON public.credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS credit_notes_company_date_idx ON public.credit_notes(company_id, issue_date);
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_notes FROM anon;
GRANT SELECT ON public.credit_notes TO authenticated;
DROP POLICY IF EXISTS cn_company_read ON public.credit_notes;
CREATE POLICY cn_company_read ON public.credit_notes FOR SELECT TO authenticated USING (public.is_company_member(auth.uid(), company_id));
DROP POLICY IF EXISTS p4_company_scope ON public.credit_notes;
CREATE POLICY p4_company_scope ON public.credit_notes AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_co_ok(company_id)) WITH CHECK (public.p4_co_ok(company_id));
DROP POLICY IF EXISTS tech_lockdown_select ON public.credit_notes;
CREATE POLICY tech_lockdown_select ON public.credit_notes AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_field_tech_only(auth.uid())));
DROP POLICY IF EXISTS rh_rep_scope ON public.credit_notes;
CREATE POLICY rh_rep_scope ON public.credit_notes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_sales_rep(auth.uid())) OR public.rep_can_see_invoice(auth.uid(), invoice_id));

-- Outstanding = total - settled payments - issued credit notes.
CREATE OR REPLACE FUNCTION public.invoice_amount_credited(p_invoice_id uuid) RETURNS numeric
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT COALESCE(sum(total), 0) FROM public.credit_notes WHERE invoice_id = p_invoice_id AND status = 'issued'
$f$;
REVOKE ALL ON FUNCTION public.invoice_amount_credited(uuid) FROM PUBLIC, anon, authenticated;

-- Status: credits count towards settling the invoice (same trigger function on payments and credit notes).
DO $p$ DECLARE d text := pg_get_functiondef('public.recalc_invoice_status()'::regprocedure);
  a text := $a$    AND status IN ('paid', 'succeeded', 'completed');$a$;
BEGIN
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'recalc anchor not found'; END IF;
  EXECUTE replace(d, a, a || E'\n  v_paid := v_paid + public.invoice_amount_credited(v_invoice_id); /*acct2*/');
END $p$;
DROP TRIGGER IF EXISTS trg_recalc_invoice_status_cn ON public.credit_notes;
CREATE TRIGGER trg_recalc_invoice_status_cn AFTER INSERT OR UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_status();

-- Aging: outstanding less credit notes.
DO $p$ DECLARE d text := pg_get_functiondef('public.get_invoice_aging_report()'::regprocedure);
  a text := $a$SUM(i.grand_total - COALESCE(paid.total_paid, 0))::numeric$a$;
BEGIN
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'aging anchor not found'; END IF;
  EXECUTE replace(d, a, $r$SUM(i.grand_total - COALESCE(paid.total_paid, 0) - public.invoice_amount_credited(i.id))::numeric /*acct2*/$r$);
END $p$;

CREATE OR REPLACE FUNCTION public._acct_office_check(p_company uuid) RETURNS void
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF auth.uid() IS NULL OR public.is_field_tech_only(auth.uid()) OR public.is_sales_rep(auth.uid()) OR NOT public.is_ops_user(auth.uid()) THEN
    RAISE EXCEPTION 'Only office staff can do this' USING ERRCODE = '42501'; END IF;
  IF p_company IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not your company' USING ERRCODE = '42501'; END IF;
END $f$;
REVOKE ALL ON FUNCTION public._acct_office_check(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_credit_note(p_invoice_id uuid, p_amount numeric DEFAULT NULL, p_reason text DEFAULT 'write_off',
  p_description text DEFAULT NULL, p_issue_date date DEFAULT CURRENT_DATE)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE i public.invoices%ROWTYPE; v_paid numeric; v_out numeric; v_amt numeric; v_rate numeric; v_vat numeric; v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice_money:' || p_invoice_id::text, 0));
  SELECT * INTO i FROM public.invoices WHERE id = p_invoice_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  PERFORM public._acct_office_check(i.company_id);
  IF COALESCE(i.status, '') IN ('draft', 'void', 'cancelled') THEN
    RAISE EXCEPTION 'Credit notes are for sent invoices (this one is %): edit a draft instead', COALESCE(i.status, 'draft'); END IF;
  IF COALESCE(p_reason, '') NOT IN ('write_off', 'deduction', 'discount', 'rounding', 'other') THEN RAISE EXCEPTION 'Unknown reason %', p_reason; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_paid FROM public.payments WHERE invoice_id = i.id AND status IN ('paid', 'succeeded', 'completed');
  v_out := ROUND(COALESCE(i.grand_total, 0) - v_paid - public.invoice_amount_credited(i.id), 2);
  v_amt := ROUND(COALESCE(p_amount, v_out), 2);
  IF v_amt <= 0 THEN RAISE EXCEPTION 'Nothing outstanding to credit'; END IF;
  IF v_amt > v_out + 0.005 THEN RAISE EXCEPTION 'Credit R % is more than the outstanding R %', to_char(v_amt, 'FM999999990.00'), to_char(v_out, 'FM999999990.00'); END IF;
  v_rate := COALESCE(i.tax_rate, 15); IF v_rate <= 1 THEN v_rate := v_rate * 100; END IF;
  IF COALESCE(i.tax_amount, 0) = 0 THEN v_rate := 0; END IF;   -- no VAT on the invoice, none on the credit
  v_vat := ROUND(v_amt * v_rate / (100 + v_rate), 2);
  INSERT INTO public.credit_notes (company_id, invoice_id, customer_id, credit_note_number, issue_date, reason, description,
    subtotal, tax_rate, tax_amount, total, created_by)
  VALUES (i.company_id, i.id, i.customer_id, 'CN-' || lpad(nextval('public.credit_note_number_seq')::text, 3, '0'),
    COALESCE(p_issue_date, CURRENT_DATE), p_reason, NULLIF(trim(COALESCE(p_description, '')), ''),
    v_amt - v_vat, v_rate, v_vat, v_amt, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.issue_credit_note(uuid, numeric, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_credit_note(uuid, numeric, text, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_credit_note(p_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE c public.credit_notes%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.credit_notes WHERE id = p_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Credit note not found'; END IF;
  PERFORM public._acct_office_check(c.company_id);
  IF c.status = 'void' THEN RETURN; END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason for voiding'; END IF;
  UPDATE public.credit_notes SET status = 'void', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid() WHERE id = p_id;
END $f$;
REVOKE ALL ON FUNCTION public.void_credit_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_credit_note(uuid, text) TO authenticated;
