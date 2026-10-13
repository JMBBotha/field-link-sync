-- Cash flow phases 1-3 (Johan 2026-10-13 13:08). Additive only. Rollback: 2026-10-13_cashflow_rollback.sql
-- Owner + admin only (never techs / sales / dispatchers), own company only.
CREATE OR REPLACE FUNCTION public._cf_ok(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND p_company IS NOT NULL
    AND NOT public.is_field_tech_only(auth.uid()) AND NOT public.is_sales_rep(auth.uid())
    AND public.has_role(auth.uid(), 'admin'::app_role)
    AND (public.is_company_admin(auth.uid(), p_company) OR p_company = public.caller_company_id())
$$;
CREATE OR REPLACE FUNCTION public._cf_check(p_company uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'Only owners and admins can see cash flow' USING ERRCODE='42501'; END IF; END $$;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_terms_days integer;

CREATE TABLE IF NOT EXISTS public.supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  bill_number text,
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  amount_excl numeric(12,2) NOT NULL DEFAULT 0,
  vat_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_incl numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft','unpaid','part_paid','paid','void')),
  notes text,
  document_path text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_bills_po_uniq ON public.supplier_bills(po_id) WHERE po_id IS NOT NULL AND status <> 'void';
CREATE INDEX IF NOT EXISTS supplier_bills_company_due ON public.supplier_bills(company_id, due_date);
CREATE INDEX IF NOT EXISTS supplier_bills_job ON public.supplier_bills(job_id);

CREATE TABLE IF NOT EXISTS public.supplier_bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_date date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL DEFAULT 'eft',
  reference text,
  bank_line_id uuid REFERENCES public.bank_lines(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sbp_bill ON public.supplier_bill_payments(bill_id);
ALTER TABLE public.bank_lines ADD COLUMN IF NOT EXISTS matched_bill_payment_id uuid REFERENCES public.supplier_bill_payments(id) ON DELETE SET NULL;

ALTER TABLE public.supplier_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_bill_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sb_owner_admin ON public.supplier_bills;
CREATE POLICY sb_owner_admin ON public.supplier_bills FOR ALL TO authenticated USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id));
DROP POLICY IF EXISTS tech_lockdown_all ON public.supplier_bills;
CREATE POLICY tech_lockdown_all ON public.supplier_bills AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_field_tech_only(auth.uid()));
DROP POLICY IF EXISTS sbp_owner_admin ON public.supplier_bill_payments;
CREATE POLICY sbp_owner_admin ON public.supplier_bill_payments FOR ALL TO authenticated USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id));
DROP POLICY IF EXISTS tech_lockdown_all ON public.supplier_bill_payments;
CREATE POLICY tech_lockdown_all ON public.supplier_bill_payments AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_field_tech_only(auth.uid()));

-- Keep amount_paid / status in step with payments
CREATE OR REPLACE FUNCTION public._sb_recalc(p_bill uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_paid numeric; b public.supplier_bills%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.supplier_bills WHERE id = p_bill;
  IF b.id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.supplier_bill_payments WHERE bill_id = p_bill;
  UPDATE public.supplier_bills SET amount_paid = v_paid, updated_at = now(),
    status = CASE WHEN b.status = 'void' THEN 'void'
                  WHEN v_paid >= b.amount_incl - 0.01 AND b.amount_incl > 0 THEN 'paid'
                  WHEN v_paid > 0 THEN 'part_paid'
                  WHEN b.status = 'draft' THEN 'draft' ELSE 'unpaid' END
  WHERE id = p_bill;
END $$;
CREATE OR REPLACE FUNCTION public.trg_sbp_recalc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public._sb_recalc(COALESCE(NEW.bill_id, OLD.bill_id)); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_sbp_recalc ON public.supplier_bill_payments;
CREATE TRIGGER trg_sbp_recalc AFTER INSERT OR UPDATE OR DELETE ON public.supplier_bill_payments FOR EACH ROW EXECUTE FUNCTION public.trg_sbp_recalc();

-- Due date from supplier terms (default 30 days) when not given
CREATE OR REPLACE FUNCTION public.trg_sb_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := NEW.bill_date + COALESCE((SELECT payment_terms_days FROM public.suppliers WHERE id = NEW.supplier_id), 30);
  END IF;
  IF NEW.supplier_name IS NULL AND NEW.supplier_id IS NOT NULL THEN
    NEW.supplier_name := (SELECT COALESCE(trading_name, name) FROM public.suppliers WHERE id = NEW.supplier_id);
  END IF;
  IF COALESCE(NEW.amount_incl,0) = 0 AND COALESCE(NEW.amount_excl,0) > 0 THEN NEW.amount_incl := NEW.amount_excl + COALESCE(NEW.vat_amount,0); END IF;
  IF NEW.status NOT IN ('void','draft') THEN
    NEW.status := CASE WHEN NEW.amount_paid >= NEW.amount_incl - 0.01 AND NEW.amount_incl > 0 THEN 'paid' WHEN NEW.amount_paid > 0 THEN 'part_paid' ELSE 'unpaid' END;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sb_defaults ON public.supplier_bills;
CREATE TRIGGER trg_sb_defaults BEFORE INSERT OR UPDATE ON public.supplier_bills FOR EACH ROW EXECUTE FUNCTION public.trg_sb_defaults();

-- Draft bill when a PO is marked received (once per PO)
CREATE OR REPLACE FUNCTION public.trg_po_received_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'received' AND OLD.status IS DISTINCT FROM 'received'
     AND NOT EXISTS (SELECT 1 FROM public.supplier_bills WHERE po_id = NEW.id AND status <> 'void') THEN
    INSERT INTO public.supplier_bills (company_id, supplier_id, po_id, job_id, bill_date, amount_excl, vat_amount, amount_incl, status, notes)
    VALUES (NEW.company_id, NEW.supplier_id, NEW.id, NEW.job_id, CURRENT_DATE, COALESCE(NEW.subtotal,0), COALESCE(NEW.vat_amount,0),
            COALESCE(NULLIF(NEW.total,0), COALESCE(NEW.subtotal,0) + COALESCE(NEW.vat_amount,0)), 'draft',
            'Draft from ' || NEW.po_number || ' (received). Check against the supplier invoice.');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_received_bill ON public.purchase_orders;
CREATE TRIGGER trg_po_received_bill AFTER UPDATE OF status ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.trg_po_received_bill();

-- Record a bill payment, optionally from a bank line (money out); marks the line matched
CREATE OR REPLACE FUNCTION public.record_bill_payment(p_bill uuid, p_amount numeric, p_date date DEFAULT CURRENT_DATE,
  p_method text DEFAULT 'eft', p_reference text DEFAULT NULL, p_bank_line uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b public.supplier_bills%ROWTYPE; l public.bank_lines%ROWTYPE; v_id uuid; v_amt numeric := p_amount; v_out numeric;
BEGIN
  SELECT * INTO b FROM public.supplier_bills WHERE id = p_bill FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  PERFORM public._cf_check(b.company_id);
  IF b.status = 'void' THEN RAISE EXCEPTION 'Bill is void'; END IF;
  IF p_bank_line IS NOT NULL THEN
    SELECT * INTO l FROM public.bank_lines WHERE id = p_bank_line AND company_id = b.company_id FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Bank line not found'; END IF;
    IF l.status <> 'new' THEN RAISE EXCEPTION 'This bank line is already %', l.status; END IF;
    IF l.amount >= 0 THEN RAISE EXCEPTION 'Only money out can pay a supplier bill'; END IF;
    v_amt := -l.amount;
  END IF;
  v_out := ROUND(b.amount_incl - b.amount_paid, 2);
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Enter an amount'; END IF;
  IF v_amt > v_out + 0.01 THEN RAISE EXCEPTION 'Amount R% is more than the R% still owed', v_amt, v_out; END IF;
  INSERT INTO public.supplier_bill_payments (bill_id, company_id, amount, paid_date, method, reference, bank_line_id)
  VALUES (b.id, b.company_id, v_amt, COALESCE(l.txn_date, p_date, CURRENT_DATE), COALESCE(p_method,'eft'),
          COALESCE(p_reference, left(concat_ws(' ', l.reference, l.description), 200)), l.id)
  RETURNING id INTO v_id;
  IF l.id IS NOT NULL THEN
    UPDATE public.bank_lines SET status='matched', matched_bill_payment_id = v_id, created_record = true, matched_by = auth.uid(), matched_at = now(),
      note = COALESCE(note, 'Supplier bill ' || COALESCE(b.bill_number, '') ) WHERE id = l.id;
  END IF;
  IF b.status = 'draft' THEN UPDATE public.supplier_bills SET status='unpaid' WHERE id = b.id; PERFORM public._sb_recalc(b.id); END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_bill_payment(p_payment uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.supplier_bill_payments%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.supplier_bill_payments WHERE id = p_payment;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  PERFORM public._cf_check(p.company_id);
  UPDATE public.bank_lines SET status='new', matched_bill_payment_id=NULL, created_record=false, matched_by=NULL, matched_at=NULL WHERE matched_bill_payment_id = p.id;
  DELETE FROM public.supplier_bill_payments WHERE id = p.id;
END $$;

-- Cash flow data (lists; the screen buckets them by week)
CREATE OR REPLACE FUNCTION public.cashflow_data(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public._cf_check(p_company);
  SELECT jsonb_build_object(
    'bank', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT ON (account_label) account_label, txn_date, balance FROM public.bank_lines
        WHERE company_id = p_company AND balance IS NOT NULL ORDER BY account_label, txn_date DESC, imported_at DESC) x), '[]'),
    'receivables', COALESCE((SELECT jsonb_agg(x ORDER BY x.due_date NULLS LAST) FROM (
        SELECT i.id, i.invoice_number, i.customer_name, i.due_date, i.issue_date, i.status, i.quote_id,
          ROUND(COALESCE(i.grand_total,0) - COALESCE((SELECT SUM(amount) FROM public.payments p WHERE p.invoice_id = i.id AND p.status IN ('paid','succeeded','completed')),0)
            - public.invoice_amount_credited(i.id), 2) AS outstanding
        FROM public.invoices i WHERE i.company_id = p_company AND COALESCE(i.status,'draft') NOT IN ('draft','void','cancelled','paid')) x
        WHERE x.outstanding > 0.009), '[]'),
    'draft_invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'invoice_number', invoice_number, 'customer_name', customer_name, 'grand_total', grand_total, 'due_date', due_date))
        FROM public.invoices WHERE company_id = p_company AND status = 'draft'), '[]'),
    'expected', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'quote_number', q.quote_number, 'customer_name', q.customer_name, 'total', q.total, 'accepted_at', q.accepted_at))
        FROM public.quotes q WHERE q.company_id = p_company AND q.status = 'accepted' AND q.superseded_by IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = q.id AND COALESCE(i.status,'') NOT IN ('void','cancelled'))), '[]'),
    'payables', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'bill_number', b.bill_number, 'supplier_name', b.supplier_name, 'due_date', b.due_date,
          'status', b.status, 'outstanding', ROUND(b.amount_incl - b.amount_paid, 2), 'po_id', b.po_id) ORDER BY b.due_date)
        FROM public.supplier_bills b WHERE b.company_id = p_company AND b.status IN ('draft','unpaid','part_paid') AND b.amount_incl - b.amount_paid > 0.009), '[]'),
    'open_pos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', po.id, 'po_number', po.po_number, 'supplier_name', s.name, 'total', po.total, 'status', po.status, 'created_at', po.created_at,
          'terms', COALESCE(s.payment_terms_days, 30)))
        FROM public.purchase_orders po LEFT JOIN public.suppliers s ON s.id = po.supplier_id
        WHERE po.company_id = p_company AND po.status IN ('approved','sent','ordered')
          AND NOT EXISTS (SELECT 1 FROM public.supplier_bills b WHERE b.po_id = po.id AND b.status <> 'void')), '[]'),
    'as_of', now()) INTO r;
  RETURN r;
END $$;

-- Profit per job (income excl VAT minus units/materials minus tech pay)
CREATE OR REPLACE FUNCTION public.job_profit(p_company uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; v_target numeric;
BEGIN
  PERFORM public._cf_check(p_company);
  SELECT COALESCE(gp_target_percent, 0) INTO v_target FROM public.companies WHERE id = p_company;
  WITH j AS (
    SELECT j.id, j.title, j.status, j.quote_id, j.invoice_id, COALESCE(j.completed_at, j.scheduled_for, j.created_at)::date AS d,
      (SELECT customer_name FROM public.quotes q WHERE q.id = j.quote_id) AS customer_name
    FROM public.jobs j WHERE j.company_id = p_company
      AND COALESCE(j.completed_at, j.scheduled_for, j.created_at)::date BETWEEN p_from AND p_to
      AND COALESCE(j.status,'') NOT IN ('cancelled')
  ), x AS (
    SELECT j.*,
      COALESCE((SELECT SUM(COALESCE(i.grand_total,0) - COALESCE(i.tax_amount,0)) FROM public.invoices i
        WHERE i.company_id = p_company AND COALESCE(i.status,'draft') NOT IN ('draft','void','cancelled')
          AND (i.id = j.invoice_id OR (j.quote_id IS NOT NULL AND i.quote_id = j.quote_id))), 0) AS income,
      COALESCE((SELECT SUM(b.amount_excl) FROM public.supplier_bills b WHERE b.company_id = p_company AND b.status <> 'void'
        AND (b.job_id = j.id OR b.po_id IN (SELECT id FROM public.purchase_orders WHERE job_id = j.id))), 0)
      + COALESCE((SELECT SUM(po.subtotal) FROM public.purchase_orders po WHERE po.job_id = j.id AND po.status NOT IN ('cancelled','draft')
        AND NOT EXISTS (SELECT 1 FROM public.supplier_bills b WHERE b.po_id = po.id AND b.status <> 'void')), 0)
      + COALESCE((SELECT SUM(e.amount_excl) FROM public.expenses e WHERE e.company_id = p_company AND e.job_id = j.id AND e.status = 'active'), 0) AS materials,
      COALESCE((SELECT SUM(t.amount - COALESCE(t.reduction_amount,0)) FROM public.tech_earnings_ledger t WHERE t.job_id = j.id
        AND COALESCE(t.status,'') NOT IN ('cancelled','void','reversed')), 0) AS tech_pay
    FROM j
  )
  SELECT jsonb_build_object('target', v_target,
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'customer_name', customer_name, 'status', status, 'date', d,
       'income', ROUND(income,2), 'materials', ROUND(materials,2), 'tech_pay', ROUND(tech_pay,2), 'profit', ROUND(income - materials - tech_pay, 2),
       'gp_pct', CASE WHEN income > 0 THEN ROUND((income - materials - tech_pay) / income * 100, 1) END) ORDER BY d DESC) FROM x), '[]'),
    'overheads', COALESCE((SELECT jsonb_agg(jsonb_build_object('month', m, 'amount', a)) FROM (
       SELECT to_char(expense_date, 'YYYY-MM') m, ROUND(SUM(amount_excl),2) a FROM public.expenses
       WHERE company_id = p_company AND job_id IS NULL AND status = 'active' AND expense_date BETWEEN p_from AND p_to GROUP BY 1) o), '[]'),
    'unbilled_income', COALESCE((SELECT jsonb_agg(jsonb_build_object('month', m, 'amount', a)) FROM (
       SELECT to_char(COALESCE(i.issue_date, i.created_at::date), 'YYYY-MM') m, ROUND(SUM(COALESCE(i.grand_total,0) - COALESCE(i.tax_amount,0)),2) a
       FROM public.invoices i WHERE i.company_id = p_company AND COALESCE(i.status,'draft') NOT IN ('draft','void','cancelled')
         AND COALESCE(i.issue_date, i.created_at::date) BETWEEN p_from AND p_to
         AND NOT EXISTS (SELECT 1 FROM public.jobs jj WHERE jj.invoice_id = i.id OR (jj.quote_id IS NOT NULL AND jj.quote_id = i.quote_id)) GROUP BY 1) u), '[]')
  ) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.record_bill_payment(uuid, numeric, date, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_bill_payment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cashflow_data(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.job_profit(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public._cf_ok(uuid), public.record_bill_payment(uuid, numeric, date, text, text, uuid), public.delete_bill_payment(uuid),
  public.cashflow_data(uuid), public.job_profit(uuid, date, date) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_bills, public.supplier_bill_payments TO authenticated;
