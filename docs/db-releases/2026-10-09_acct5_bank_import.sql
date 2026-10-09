-- acct5: FNB CSV bank import. Lines are deduped by a hash of company + account + date + amount + reference (+ occurrence
-- of that same combination within one file). Matching only suggests; the office confirms. A line links to at most one
-- payment/expense, and a payment/expense to at most one line, so nothing is counted twice.
CREATE TABLE IF NOT EXISTS public.bank_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  account_label text NOT NULL DEFAULT 'FNB',
  txn_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  description text,
  reference text,
  balance numeric(14,2),
  line_hash text NOT NULL,
  import_batch uuid NOT NULL,
  imported_by uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'matched', 'ignored')),
  matched_payment_id uuid REFERENCES public.payments(id),
  matched_expense_id uuid REFERENCES public.expenses(id),
  created_record boolean NOT NULL DEFAULT false,
  matched_by uuid,
  matched_at timestamptz,
  note text,
  CONSTRAINT bank_lines_hash_uq UNIQUE (company_id, line_hash),
  CONSTRAINT bank_lines_one_link CHECK (NOT (matched_payment_id IS NOT NULL AND matched_expense_id IS NOT NULL)),
  CONSTRAINT bank_lines_matched_has_link CHECK (status <> 'matched' OR matched_payment_id IS NOT NULL OR matched_expense_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_lines_payment_uq ON public.bank_lines(matched_payment_id) WHERE matched_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_lines_expense_uq ON public.bank_lines(matched_expense_id) WHERE matched_expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_lines_company_date_idx ON public.bank_lines(company_id, txn_date DESC);
ALTER TABLE public.bank_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_lines FROM anon, authenticated;
GRANT SELECT ON public.bank_lines TO authenticated;
CREATE POLICY bl_office_read ON public.bank_lines FOR SELECT TO authenticated USING (public._acct_is_office(company_id));
CREATE POLICY tech_lockdown_all ON public.bank_lines AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_field_tech_only(auth.uid()));
CREATE POLICY p4_company_scope ON public.bank_lines AS RESTRICTIVE FOR ALL TO authenticated USING (public.p4_co_ok(company_id));

CREATE OR REPLACE FUNCTION public._bank_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(upper(COALESCE(t, '')), '[^A-Z0-9]', '', 'g') $f$;

-- Import parsed lines: [{date, amount, description, reference, balance}]. Returns counts; duplicates are skipped.
CREATE OR REPLACE FUNCTION public.import_bank_lines(p_lines jsonb, p_account text DEFAULT 'FNB') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_co uuid := public.caller_company_id(); v_batch uuid := gen_random_uuid(); v_total int; v_ins int;
BEGIN
  PERFORM public._acct_office_check(v_co);
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'Expected a list of lines'; END IF;
  v_total := jsonb_array_length(p_lines);
  IF v_total > 5000 THEN RAISE EXCEPTION 'Too many lines in one file (max 5000)'; END IF;
  WITH src AS (
    SELECT (x->>'date')::date d, ROUND((x->>'amount')::numeric, 2) a, NULLIF(btrim(x->>'description'), '') descr,
           NULLIF(btrim(x->>'reference'), '') ref, NULLIF(x->>'balance', '')::numeric bal, o
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY t(x, o)
     WHERE (x->>'amount') IS NOT NULL AND (x->>'amount')::numeric <> 0 AND (x->>'date') IS NOT NULL
  ), keyed AS (
    SELECT src.*, public._bank_norm(COALESCE(ref, descr)) k,
           row_number() OVER (PARTITION BY d, a, public._bank_norm(COALESCE(ref, descr)) ORDER BY o) occ
      FROM src
  ), ins AS (
    INSERT INTO public.bank_lines (company_id, account_label, txn_date, amount, description, reference, balance, line_hash, import_batch, imported_by)
    SELECT v_co, COALESCE(NULLIF(btrim(p_account), ''), 'FNB'), d, a, left(descr, 300), left(ref, 120), bal,
           encode(sha256(convert_to(concat_ws('|', v_co, COALESCE(NULLIF(btrim(p_account), ''), 'FNB'), d, a, k, occ), 'UTF8')), 'hex'),
           v_batch, auth.uid()
      FROM keyed
    ON CONFLICT (company_id, line_hash) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_ins FROM ins;
  RETURN jsonb_build_object('batch', v_batch, 'received', v_total, 'inserted', v_ins, 'duplicates', v_total - v_ins);
END $f$;

-- Suggestions (never auto-applied). Money in: open invoices / unlinked payments. Money out: unlinked expenses.
CREATE OR REPLACE FUNCTION public.bank_match_suggestions(p_line uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l public.bank_lines%ROWTYPE; v_text text; r jsonb;
BEGIN
  SELECT * INTO l FROM public.bank_lines WHERE id = p_line;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public._acct_office_check(l.company_id);
  v_text := public._bank_norm(concat_ws(' ', l.description, l.reference));
  IF l.amount > 0 THEN
    WITH inv AS (
      SELECT i.id, i.invoice_number, i.customer_name, i.grand_total, i.issue_date, i.due_date,
             ROUND(COALESCE(i.grand_total, 0) - COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.invoice_id = i.id AND p.status IN ('paid','succeeded','completed')), 0)
                   - public.invoice_amount_credited(i.id), 2) outstanding
        FROM public.invoices i
       WHERE i.company_id = l.company_id AND COALESCE(i.status, 'draft') NOT IN ('draft', 'void', 'cancelled')
    ), cand AS (
      SELECT 'invoice' kind, inv.id target, inv.invoice_number label, inv.customer_name who, inv.outstanding amount, inv.issue_date dt,
             (CASE WHEN ABS(inv.outstanding - l.amount) < 0.01 THEN 50 WHEN ABS(COALESCE(inv.grand_total, 0) - l.amount) < 0.01 THEN 25 ELSE 0 END
              + CASE WHEN length(public._bank_norm(inv.invoice_number)) >= 3 AND (v_text LIKE '%' || public._bank_norm(inv.invoice_number) || '%'
                       OR (regexp_replace(inv.invoice_number, '\D', '', 'g') <> '' AND v_text ~ ('(INV|INVOICE)0*' || ltrim(regexp_replace(inv.invoice_number, '\D', '', 'g'), '0') || '(?![0-9])'))) THEN 40 ELSE 0 END
              + CASE WHEN ABS(COALESCE(inv.due_date, inv.issue_date) - l.txn_date) <= 5 OR ABS(inv.issue_date - l.txn_date) <= 5 THEN 10 ELSE 0 END) score
        FROM inv WHERE inv.outstanding > 0.005
      UNION ALL
      SELECT 'payment', p.id, i.invoice_number, i.customer_name, p.amount, p.payment_date,
             50 + CASE WHEN ABS(p.payment_date - l.txn_date) <= 5 THEN 30 ELSE 0 END
               + CASE WHEN v_text LIKE '%' || public._bank_norm(i.invoice_number) || '%' THEN 20 ELSE 0 END
        FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
       WHERE i.company_id = l.company_id AND p.status IN ('paid','succeeded','completed') AND ABS(p.amount - l.amount) < 0.01
         AND ABS(p.payment_date - l.txn_date) <= 5
         AND NOT EXISTS (SELECT 1 FROM public.bank_lines b WHERE b.matched_payment_id = p.id)
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.score DESC, c.dt DESC NULLS LAST), '[]'::jsonb) INTO r
      FROM (SELECT * FROM cand WHERE score >= 40 ORDER BY score DESC LIMIT 8) c;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.score DESC), '[]'::jsonb) INTO r FROM (
      SELECT 'expense' kind, e.id target, COALESCE(e.supplier_name, e.description, e.category) label, e.category who, e.amount_incl amount, e.expense_date dt,
             50 + CASE WHEN ABS(e.expense_date - l.txn_date) <= 5 THEN 30 ELSE 0 END
               + CASE WHEN length(public._bank_norm(e.reference)) >= 3 AND v_text LIKE '%' || public._bank_norm(e.reference) || '%' THEN 20 ELSE 0 END score
        FROM public.expenses e
       WHERE e.company_id = l.company_id AND e.status = 'active' AND ABS(e.amount_incl + l.amount) < 0.01
         AND ABS(e.expense_date - l.txn_date) <= 5
         AND NOT EXISTS (SELECT 1 FROM public.bank_lines b WHERE b.matched_expense_id = e.id)
       ORDER BY 7 DESC LIMIT 8) c;
  END IF;
  RETURN r;
END $f$;

-- Confirm one line. p_kind: invoice (creates an EFT payment), payment (links existing), expense (links existing),
-- new_expense (creates an expense from the line), ignore (e.g. own-account transfer).
CREATE OR REPLACE FUNCTION public.confirm_bank_line(p_line uuid, p_kind text, p_target uuid DEFAULT NULL, p_category text DEFAULT 'other', p_vat_claimable boolean DEFAULT true, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l public.bank_lines%ROWTYPE; v_id uuid; v_out numeric; v_inv record;
BEGIN
  SELECT * INTO l FROM public.bank_lines WHERE id = p_line FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public._acct_office_check(l.company_id);
  IF l.status <> 'new' THEN RAISE EXCEPTION 'This bank line is already %', l.status USING ERRCODE = '23505'; END IF;

  IF p_kind = 'invoice' THEN
    IF l.amount <= 0 THEN RAISE EXCEPTION 'Only money in can pay an invoice'; END IF;
    SELECT * INTO v_inv FROM public.invoices WHERE id = p_target AND company_id = l.company_id FOR UPDATE;
    IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF COALESCE(v_inv.status, 'draft') IN ('draft', 'void', 'cancelled') THEN RAISE EXCEPTION 'Invoice is %', v_inv.status; END IF;
    v_out := ROUND(COALESCE(v_inv.grand_total, 0) - COALESCE((SELECT SUM(amount) FROM public.payments WHERE invoice_id = v_inv.id AND status IN ('paid','succeeded','completed')), 0) - public.invoice_amount_credited(v_inv.id), 2);
    IF l.amount > v_out + 0.01 THEN RAISE EXCEPTION 'Amount R% is more than the R% outstanding on %', l.amount, v_out, v_inv.invoice_number; END IF;
    INSERT INTO public.payments (invoice_id, amount, method, reference, payment_date, gateway, status, company_id, created_by)
    VALUES (v_inv.id, l.amount, 'eft', left(concat_ws(' ', 'Bank', l.reference, l.description), 200), l.txn_date, 'manual', 'paid', l.company_id, auth.uid())
    RETURNING id INTO v_id;
    UPDATE public.bank_lines SET status = 'matched', matched_payment_id = v_id, created_record = true, matched_by = auth.uid(), matched_at = now(), note = p_note WHERE id = l.id;
  ELSIF p_kind = 'payment' THEN
    IF NOT EXISTS (SELECT 1 FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id WHERE p.id = p_target AND i.company_id = l.company_id
                   AND p.status IN ('paid','succeeded','completed') AND ABS(p.amount - l.amount) < 0.01) THEN
      RAISE EXCEPTION 'Payment not found or amount differs'; END IF;
    UPDATE public.bank_lines SET status = 'matched', matched_payment_id = p_target, matched_by = auth.uid(), matched_at = now(), note = p_note WHERE id = l.id;
  ELSIF p_kind = 'expense' THEN
    IF NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = p_target AND e.company_id = l.company_id AND e.status = 'active' AND ABS(e.amount_incl + l.amount) < 0.01) THEN
      RAISE EXCEPTION 'Expense not found or amount differs'; END IF;
    UPDATE public.bank_lines SET status = 'matched', matched_expense_id = p_target, matched_by = auth.uid(), matched_at = now(), note = p_note WHERE id = l.id;
  ELSIF p_kind = 'new_expense' THEN
    IF l.amount >= 0 THEN RAISE EXCEPTION 'Only money out can become an expense'; END IF;
    INSERT INTO public.expenses (company_id, expense_date, supplier_name, category, description, amount_incl, vat_claimable, reference, source, source_id, created_by)
    VALUES (l.company_id, l.txn_date, left(COALESCE(l.description, 'Bank'), 120), COALESCE(p_category, 'other'), p_note, -l.amount, COALESCE(p_vat_claimable, true), l.reference, 'bank', l.id, auth.uid())
    RETURNING id INTO v_id;
    UPDATE public.bank_lines SET status = 'matched', matched_expense_id = v_id, created_record = true, matched_by = auth.uid(), matched_at = now(), note = p_note WHERE id = l.id;
  ELSIF p_kind = 'ignore' THEN
    UPDATE public.bank_lines SET status = 'ignored', matched_by = auth.uid(), matched_at = now(), note = p_note WHERE id = l.id;
  ELSE
    RAISE EXCEPTION 'Unknown match type %', p_kind;
  END IF;
  RETURN jsonb_build_object('line', l.id, 'kind', p_kind, 'record', v_id);
END $f$;

-- Undo a confirmation. A payment/expense this line created is cancelled/archived (kept, never deleted).
CREATE OR REPLACE FUNCTION public.unmatch_bank_line(p_line uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l public.bank_lines%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.bank_lines WHERE id = p_line FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public._acct_office_check(l.company_id);
  IF l.created_record AND l.matched_payment_id IS NOT NULL THEN
    UPDATE public.payments SET status = 'cancelled', reference = left(concat_ws(' ', reference, '(bank match undone)'), 200) WHERE id = l.matched_payment_id;
  END IF;
  IF l.created_record AND l.matched_expense_id IS NOT NULL THEN
    UPDATE public.expenses SET status = 'archived' WHERE id = l.matched_expense_id;
  END IF;
  UPDATE public.bank_lines SET status = 'new', matched_payment_id = NULL, matched_expense_id = NULL, created_record = false, matched_by = NULL, matched_at = NULL WHERE id = l.id;
END $f$;

REVOKE ALL ON FUNCTION public.import_bank_lines(jsonb, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.bank_match_suggestions(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.confirm_bank_line(uuid, text, uuid, text, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unmatch_bank_line(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_bank_lines(jsonb, text), public.bank_match_suggestions(uuid), public.confirm_bank_line(uuid, text, uuid, text, boolean, text), public.unmatch_bank_line(uuid) TO authenticated;
